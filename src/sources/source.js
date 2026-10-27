/**
 * @fileoverview The contract every source implements, and its validation.
 *
 * A source is where anime comes from, like an Aniyomi extension. Sources run
 * inside a node (src/server), which exposes them over HTTP to any UI: the
 * Electron app, the hosted web app, or another browser.
 *
 * Built-in sources: hianime (the ani-cli port) and local (a folder of videos).
 * Drop-in sources: any CommonJS file in the node's sources folder that exports
 * an object matching {@link Source}. See docs/sources.md for an example.
 */

/**
 * One series.
 * @typedef {{id: string, title: string, poster: (string|undefined), info: (string|undefined)}}
 * - id: stable within the source; stored in the library.
 * - poster: image URL.
 * - info: one short line under the title, e.g. 'Sub 28 · Dub 28'.
 */
let Anime;

/**
 * One episode.
 * @typedef {{id: string, number: string, title: string}}
 * - id: stable within the source; stored with watch progress.
 * - number: display number (a string, since some are '12.5').
 */
let Episode;

/**
 * Where to play an episode from. A node turns this into URLs the client can use.
 * @typedef {{
 *   type: string,
 *   url: (string|undefined),
 *   referer: (string|undefined),
 *   path: (string|undefined),
 *   subtitleUrl: (?string|undefined),
 *   subtitlePath: (?string|undefined),
 * }}
 * - type 'hls': `url` is an m3u8 playlist; `referer` is sent with every request to it.
 * - type 'file': `path` is a video file on the node's disk.
 * - type 'http': `url` is a plain video file (mp4, webm) on the web.
 * - subtitleUrl / subtitlePath: optional WebVTT track.
 */
let Stream;

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description: (string|undefined),
 *   modes: (!Array<string>|undefined),
 *   downloadable: (boolean|undefined),
 *   search: function(string): !Promise<!Array<!Anime>>,
 *   getEpisodes: function(string): !Promise<!Array<!Episode>>,
 *   getStream: function(string, {mode: string, quality: string}): !Promise<!Stream>,
 *   transform: (function(string, string, string): (string|!Promise<string>)|undefined),
 * }}
 * - id: unique within a node; lowercase letters, digits and dashes.
 * - modes: audio options the user can pick, e.g. ['sub', 'dub']. Omit if none.
 * - downloadable: true if the app should offer downloads (sensible for 'hls'/'http').
 * - transform(body, url, kind): optional; the proxy passes it every HLS playlist
 *   (kind '') and the subtitle file (kind 'sub') of this source's streams, and
 *   serves what it returns: a plain playlist, or WebVTT for subtitles.
 */
let Source;

/**
 * Checks that an object implements {@link Source}.
 * @param {*} source
 * @return {?string} What's wrong, or null if it's valid.
 */
function validateSource(source) {
  if (!source || typeof source !== 'object') return 'not an object';
  if (typeof source.id !== 'string' || !/^[a-z0-9-]+$/.test(source.id)) {
    return 'id must be lowercase letters, digits and dashes';
  }
  if (typeof source.name !== 'string' || !source.name) return 'name is missing';
  for (const method of ['search', 'getEpisodes', 'getStream']) {
    if (typeof source[method] !== 'function') return `${method}() is missing`;
  }
  return null;
}

/**
 * The public description of a source, as sent to clients.
 * @param {!Source} source
 * @return {{id: string, name: string, description: string, modes: !Array<string>,
 *     downloadable: boolean}}
 */
function describeSource(source) {
  return {
    id: source.id,
    name: source.name,
    description: source.description || '',
    modes: source.modes || [],
    downloadable: Boolean(source.downloadable),
  };
}

module.exports = {validateSource, describeSource};
