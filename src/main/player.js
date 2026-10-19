/**
 * @fileoverview Plays an episode in an external player: mpv (preferred), falling
 * back to ffplay, which comes with ffmpeg.
 *
 * Both players stream the HLS URL directly. They need the CDN's Referer and the
 * browser user agent, plus `extension_picky=0`: the segments are named `.ts.jpg`,
 * and recent ffmpeg versions refuse unexpected extensions in HLS unless this is turned off.
 */

const {USER_AGENT} = require('../scraper/http');
const {getStreamLinks, pickStream} = require('../scraper/hianime');
const {launchDetached} = require('./process');

/**
 * @typedef {{episodeId: string, mode: string, quality: string, title: string}}
 * - mode: 'sub' or 'dub'.
 * - quality: e.g. '720p' or 'best'.
 * - title: window title, e.g. "Frieren Episode 1".
 */
let PlayRequest;

/**
 * Resolves the episode's stream and opens it in the first player found on PATH.
 * Returns as soon as the player has started; it then runs on its own.
 * @param {!PlayRequest} request
 * @return {!Promise<string>} Name of the player that was started.
 * @throws {Error} If neither mpv nor ffplay is installed, or the stream can't be resolved.
 */
async function playEpisode({episodeId, mode, quality, title}) {
  const links = await getStreamLinks(episodeId, mode);
  const {url} = pickStream(links.streams, quality);
  const players = [
    ['mpv', buildMpvArgs(links, url, title)],
    // ponytail: ffplay fallback has no subtitles; install mpv for subs + seeking UI.
    ['ffplay', buildFfplayArgs(links, url, title)],
  ];
  for (const [command, args] of players) {
    try {
      await launchDetached(command, args);
      return command;
    } catch (error) {
      // Not installed: try the next player. Any other error is a real failure.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('No player found: install mpv (or ffmpeg for ffplay) and add it to PATH');
}

/**
 * mpv command line, the same as ani-cli's.
 * @param {!import('../scraper/hianime').StreamLinks} links
 * @param {string} url Variant playlist to play.
 * @param {string} title
 * @return {!Array<string>}
 */
function buildMpvArgs(links, url, title) {
  return [
    `--referrer=${links.referer}`,
    `--user-agent=${USER_AGENT}`,
    '--demuxer-lavf-o=extension_picky=0',
    ...(links.subtitleUrl ? [`--sub-file=${links.subtitleUrl}`] : []),
    `--force-media-title=${title}`,
    url,
  ];
}

/**
 * ffplay command line. Options before the URL apply to the input (HTTP + HLS).
 * @param {!import('../scraper/hianime').StreamLinks} links
 * @param {string} url Variant playlist to play.
 * @param {string} title
 * @return {!Array<string>}
 */
function buildFfplayArgs(links, url, title) {
  return [
    '-loglevel', 'error',
    '-extension_picky', '0',
    '-window_title', title,
    '-referer', links.referer,
    '-user_agent', USER_AGENT,
    url,
  ];
}

module.exports = {playEpisode};
