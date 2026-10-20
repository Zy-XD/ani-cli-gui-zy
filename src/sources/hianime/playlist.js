/**
 * @fileoverview HLS (m3u8) playlist parsing.
 *
 * HLS uses two kinds of playlist:
 * - A master playlist lists one variant per quality:
 *
 *       #EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
 *       720/index.m3u8
 *
 * - A media playlist lists the segments of one variant, each with its length:
 *
 *       #EXTINF:4.004,
 *       seg_00000.ts.jpg
 */

/**
 * One quality variant.
 * @typedef {{label: string, url: string}}
 * - label: '<height>p' (e.g. '1080p'), or 'auto' when the playlist has no variants.
 * - url: absolute URL of the variant's media playlist.
 */
let Stream;

/**
 * Lists the variant streams of a master playlist, best quality first.
 * A media playlist (no variants) yields a single 'auto' stream pointing at itself.
 * @param {string} playlist Master playlist text.
 * @param {string} playlistUrl URL the playlist came from, used to resolve relative URIs.
 * @return {!Array<!Stream>}
 */
function parseMasterPlaylist(playlist, playlistUrl) {
  const lines = playlist.split(/\r?\n/);
  const streams = [];
  lines.forEach((line, index) => {
    // Each #EXT-X-STREAM-INF tag describes the URI on the line after it.
    const resolution = line.startsWith('#EXT-X-STREAM-INF') && line.match(/RESOLUTION=\d+x(\d+)/);
    if (resolution) {
      streams.push({
        label: `${resolution[1]}p`,
        url: new URL(lines[index + 1].trim(), playlistUrl).href,
      });
    }
  });
  streams.sort((a, b) => parseInt(b.label, 10) - parseInt(a.label, 10));
  return streams.length ? streams : [{label: 'auto', url: playlistUrl}];
}

/**
 * Total duration of a media playlist: the sum of its #EXTINF segment lengths.
 * Used as the 100% mark for download progress.
 * @param {string} playlist Media playlist text.
 * @return {number} Seconds; 0 if the playlist has no segments.
 */
function getPlaylistDuration(playlist) {
  return [...playlist.matchAll(/#EXTINF:([\d.]+)/g)]
    .reduce((total, match) => total + Number(match[1]), 0);
}

module.exports = {parseMasterPlaylist, getPlaylistDuration};
