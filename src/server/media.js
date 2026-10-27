/**
 * @fileoverview Turns a source's Stream into URLs a browser can play, and serves them:
 * - /api/proxy fetches a remote URL with the Referer and user agent the CDN
 *   requires (browsers can't set those), adds CORS headers, and rewrites HLS
 *   playlists so every segment also goes through the proxy.
 * - /api/file streams a file from disk, with Range support for seeking.
 *
 * Both take signed parameters (see signed_urls.js).
 */

const fs = require('fs');
const path = require('path');
const {Readable} = require('stream');
const {USER_AGENT} = require('../sources/hianime/http');
const {signParams, verifyParams} = require('./signed_urls');

/** Response headers worth passing on from the upstream server. */
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t', '.vtt': 'text/vtt',
};

/**
 * Relative URL (from /api/...) that proxies `url`.
 * @param {string} url
 * @param {string=} referer
 * @param {string=} via Id of a source whose transform() rewrites the playlists, or ''.
 * @param {string=} kind 'sub' if this is a subtitle track (also passed to transform()).
 * @return {string} e.g. 'proxy?u=...&r=...&x=...&k=...&s=...'.
 */
function proxyPath(url, referer = '', via = '', kind = '') {
  return `proxy?${signParams({u: url, r: referer, x: via, k: kind})}`;
}

/**
 * Relative URL (from /api/...) that serves a local file.
 * @param {string} absolutePath
 * @return {string}
 */
function filePathFor(absolutePath) {
  return `file?${signParams({p: absolutePath})}`;
}

/**
 * Converts a source's Stream into client URLs, relative to the node's /api/ path.
 * @param {!import('../sources/source').Stream} stream
 * @param {!import('../sources/source').Source=} source Its transform(), if any, is applied by the proxy.
 * @return {{type: string, url: string, subtitleUrl: ?string}}
 *     type is 'hls' or 'file' (a plain video the browser can play directly).
 */
function toClientStream(stream, source) {
  const via = source?.transform ? source.id : '';
  if (stream.type === 'file') {
    return {
      type: 'file',
      url: filePathFor(stream.path),
      subtitleUrl: stream.subtitlePath ? filePathFor(stream.subtitlePath) : null,
    };
  }
  if (stream.type === 'hls' || stream.type === 'http') {
    return {
      type: stream.type === 'hls' ? 'hls' : 'file',
      url: proxyPath(stream.url, stream.referer, via),
      subtitleUrl: stream.subtitleUrl ? proxyPath(stream.subtitleUrl, stream.referer, via, 'sub') : null,
    };
  }
  throw new Error(`Unknown stream type "${stream.type}"`);
}

/**
 * Points every URI in an HLS playlist at the proxy, keeping the same referer.
 * URIs appear on their own line (segments, variants) or in URI="..." attributes
 * (encryption keys, audio/subtitle renditions).
 * @param {string} playlist
 * @param {string} playlistUrl Upstream URL, to resolve relative URIs.
 * @param {string} referer
 * @param {string=} via Passed on, so child playlists get the same transform.
 * @return {string}
 */
function rewritePlaylist(playlist, playlistUrl, referer, via = '') {
  const toProxy = (uri) => proxyPath(new URL(uri, playlistUrl).href, referer, via);
  return playlist.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (match, uri) => `URI="${toProxy(uri)}"`);
    return toProxy(line.trim());
  }).join('\n');
}

/**
 * Handles GET /api/proxy.
 * @param {!URLSearchParams} query
 * @param {!import('http').IncomingMessage} request
 * @param {!import('http').ServerResponse} response
 * @param {!Map<string, !import('../sources/source').Source>} sourcesById For transform().
 * @return {!Promise<void>}
 */
async function handleProxy(query, request, response, sourcesById) {
  const params = verifyParams(query, ['u', 'r', 'x', 'k']);
  if (!params) return sendError(response, 403, 'Bad signature');
  const headers = {'User-Agent': USER_AGENT};
  if (params.r) headers['Referer'] = params.r;
  if (request.headers.range) headers['Range'] = request.headers.range;

  const upstream = await fetch(params.u, {headers});
  const type = upstream.headers.get('content-type') || '';
  const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(new URL(params.u).pathname);
  const transform = sourcesById.get(params.x)?.transform;
  if (upstream.ok && (isPlaylist || (transform && params.k === 'sub'))) {
    let body = await upstream.text();
    if (transform) body = await transform(body, params.u, params.k);
    if (!isPlaylist) {
      response.writeHead(200, {'Content-Type': 'text/vtt; charset=utf-8'});
      return void response.end(body);
    }
    response.writeHead(200, {'Content-Type': 'application/vnd.apple.mpegurl'});
    return void response.end(rewritePlaylist(body, params.u, params.r, params.x));
  }
  const forwarded = {};
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) forwarded[name] = value;
  }
  response.writeHead(upstream.status, forwarded);
  if (!upstream.body) return void response.end();
  Readable.fromWeb(upstream.body).on('error', () => response.destroy()).pipe(response);
}

/**
 * Handles GET /api/file, honouring a single `Range: bytes=start-end` header.
 * @param {!URLSearchParams} query
 * @param {!import('http').IncomingMessage} request
 * @param {!import('http').ServerResponse} response
 */
function handleFile(query, request, response) {
  const params = verifyParams(query, ['p']);
  if (!params) return sendError(response, 403, 'Bad signature');
  let size;
  try {
    size = fs.statSync(params.p).size;
  } catch {
    return sendError(response, 404, 'File not found');
  }
  const headers = {
    'Content-Type': MIME_TYPES[path.extname(params.p).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
  if (!range) {
    response.writeHead(200, {...headers, 'Content-Length': size});
    return void fs.createReadStream(params.p).pipe(response);
  }
  // 'bytes=-500' means the last 500 bytes; 'bytes=500-' means from 500 to the end.
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) {
    response.writeHead(416, {'Content-Range': `bytes */${size}`});
    return void response.end();
  }
  response.writeHead(206, {
    ...headers,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
  });
  fs.createReadStream(params.p, {start, end}).pipe(response);
}

/**
 * @param {!import('http').ServerResponse} response
 * @param {number} status
 * @param {string} message
 */
function sendError(response, status, message) {
  response.writeHead(status, {'Content-Type': 'application/json'});
  response.end(JSON.stringify({error: message}));
}

module.exports = {toClientStream, rewritePlaylist, handleProxy, handleFile, sendError};
