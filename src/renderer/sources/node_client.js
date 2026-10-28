/**
 * @fileoverview Talks to a node (src/server/server.js) over HTTP and wraps
 * each of its sources as a ClientSource.
 */

/**
 * What the UI works with, whatever the source's origin (a node or the browser).
 * @typedef {{
 *   key: string,
 *   name: string,
 *   nodeName: string,
 *   description: string,
 *   modes: !Array<string>,
 *   downloadable: boolean,
 *   search: function(string): !Promise<!Array<!Object>>,
 *   getEpisodes: function(string): !Promise<!Array<!Object>>,
 *   getStream: function(string, {mode: string, quality: string}):
 *       !Promise<{type: string, url: string, subtitleUrl: ?string}>,
 *   getDownloadRequest: (function(string, {mode: string, quality: string}):
 *       {apiBase: string, streamPath: string}|undefined),
 * }}
 * - key: '<node id>#<source id>'; stored in the library to find the source again.
 * - getStream: url and subtitleUrl are absolute ('hls' = playlist, 'file' = plain video).
 * - getDownloadRequest: what the desktop downloader needs (nodes only).
 */
let ClientSource;

/**
 * @param {string} url
 * @return {!Promise<*>}
 * @throws {Error} With the node's error message, or a hint if it's unreachable.
 */
async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Can't reach ${new URL(url).origin}. Is the node running?`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

/**
 * Connects to a node and lists its sources.
 * @param {{id: string, url: string}} node
 *     - id: stable id stored in source keys ('app' for the desktop app's own node,
 *       the URL for others).
 *     - url: base URL with the node's key, e.g. 'http://localhost:7777/<key>/'.
 * @return {!Promise<{name: string, sources: !Array<!ClientSource>}>}
 */
export async function connectToNode({id, url}) {
  const apiBase = new URL('api/', url.endsWith('/') ? url : `${url}/`).href;
  const info = await fetchJson(`${apiBase}info`);
  const sources = info.sources.map((source) => {
    const sourceBase = `${apiBase}sources/${encodeURIComponent(source.id)}/`;
    const streamPath = (episodeId, {mode, quality}) =>
      `sources/${encodeURIComponent(source.id)}/stream?` +
      new URLSearchParams({episodeId, mode, quality});
    return {
      key: `${id}#${source.id}`,
      name: source.name,
      nodeName: info.name,
      description: source.description,
      modes: source.modes,
      downloadable: source.downloadable,
      search: (query) => fetchJson(`${sourceBase}search?${new URLSearchParams({q: query})}`),
      getEpisodes: (animeId) => fetchJson(`${sourceBase}episodes?${new URLSearchParams({animeId})}`),
      async getStream(episodeId, options) {
        const stream = await fetchJson(apiBase + streamPath(episodeId, options));
        // The node returns URLs relative to its /api/ path.
        return {
          type: stream.type,
          url: new URL(stream.url, apiBase).href,
          subtitleUrl: stream.subtitleUrl ? new URL(stream.subtitleUrl, apiBase).href : null,
        };
      },
      getDownloadRequest: (episodeId, options) => ({apiBase, streamPath: streamPath(episodeId, options)}),
    };
  });
  return {name: info.name, sources};
}
