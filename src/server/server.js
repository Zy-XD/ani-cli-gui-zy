/**
 * @fileoverview A node: an HTTP server that exposes sources to any client.
 *
 * API (all JSON unless noted; every response allows any origin via CORS):
 *   GET /api/info                                   -> {name, version, sources: [...]}
 *   GET /api/sources/<id>/search?q=                 -> Anime[]
 *   GET /api/sources/<id>/episodes?animeId=         -> Episode[]
 *   GET /api/sources/<id>/stream?episodeId=&mode=&quality=
 *                                                   -> {type: 'hls'|'file', url, subtitleUrl}
 *       url and subtitleUrl are relative to /api/ (e.g. 'proxy?...').
 *   GET /api/proxy?u=&r=&s=                         -> proxied bytes (see media.js)
 *   GET /api/file?p=&s=                             -> file bytes, with Range support
 *   Anything else                                   -> the web UI, if `staticDir` is set
 *
 * The Electron app starts one on 127.0.0.1 (see src/main/main.js);
 * `npm run serve` starts a standalone one (see cli.js).
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const {describeSource} = require('../sources/source');
const {toClientStream, handleProxy, handleFile, sendError} = require('./media');
const {version} = require('../../package.json');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  // Lets pages on the internet (e.g. GitHub Pages) reach a node on localhost in
  // Chrome, which asks first ("Private Network Access").
  'Access-Control-Allow-Private-Network': 'true',
};

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

/**
 * @param {{
 *   name: string,
 *   sources: !Array<!import('../sources/source').Source>,
 *   staticDir: (string|undefined),
 * }} options
 *   - name: shown in the UI's source list.
 *   - staticDir: folder of the web UI to serve at '/'.
 * @return {!http.Server} Not listening yet; call listen().
 */
function createNodeServer({name, sources, staticDir}) {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));

  /**
   * Answers /api/sources/<id>/<action>.
   * @param {string} sourceId
   * @param {string} action
   * @param {!URLSearchParams} query
   * @return {!Promise<*>} JSON body.
   */
  const handleSourceAction = async (sourceId, action, query) => {
    const source = sourcesById.get(sourceId);
    if (!source) throw Object.assign(new Error(`No source "${sourceId}"`), {status: 404});
    if (action === 'search') return source.search(query.get('q') || '');
    if (action === 'episodes') return source.getEpisodes(query.get('animeId') || '');
    if (action === 'stream') {
      const options = {mode: query.get('mode') || 'sub', quality: query.get('quality') || 'best'};
      return toClientStream(await source.getStream(query.get('episodeId') || '', options), source);
    }
    throw Object.assign(new Error(`Unknown action "${action}"`), {status: 404});
  };

  return http.createServer(async (request, response) => {
    for (const [header, value] of Object.entries(CORS_HEADERS)) response.setHeader(header, value);
    if (request.method === 'OPTIONS') return void response.writeHead(204).end();
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendError(response, 405, 'GET only');

    const url = new URL(request.url, 'http://node');
    try {
      if (url.pathname === '/api/proxy') return await handleProxy(url.searchParams, request, response, sourcesById);
      if (url.pathname === '/api/file') return handleFile(url.searchParams, request, response);
      if (url.pathname === '/api/info') {
        return sendJson(response, {name, version, sources: sources.map(describeSource)});
      }
      const action = url.pathname.match(/^\/api\/sources\/([^/]+)\/([a-z]+)$/);
      if (action) {
        const sourceId = decodeURIComponent(action[1]);
        return sendJson(response, await handleSourceAction(sourceId, action[2], url.searchParams));
      }
      if (url.pathname.startsWith('/api/')) return sendError(response, 404, 'Not found');
      if (staticDir) return serveStatic(staticDir, url.pathname, response);
      sendError(response, 404, 'Not found');
    } catch (error) {
      if (response.headersSent) return void response.destroy();
      sendError(response, error.status || 502, error.message);
    }
  });
}

/**
 * @param {!http.ServerResponse} response
 * @param {*} body
 */
function sendJson(response, body) {
  response.writeHead(200, {'Content-Type': 'application/json'});
  response.end(JSON.stringify(body));
}

/**
 * Serves a file of the web UI. Paths that escape the folder get a 404.
 * @param {string} staticDir
 * @param {string} pathname
 * @param {!http.ServerResponse} response
 */
function serveStatic(staticDir, pathname, response) {
  const root = path.resolve(staticDir);
  const filePath = path.resolve(root, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendError(response, 404, 'Not found');
  }
  response.writeHead(200, {'Content-Type': STATIC_TYPES[path.extname(filePath)] || 'application/octet-stream'});
  fs.createReadStream(filePath).pipe(response);
}

module.exports = {createNodeServer};
