/**
 * @fileoverview Plays a stream in an external player: mpv (preferred), falling
 * back to ffplay, which comes with ffmpeg.
 *
 * Streams come from a node's proxy, so the players don't need the CDN's referer.
 * They still need `extension_picky=0`: proxied segment URLs have no file
 * extension, and recent ffmpeg versions (which mpv uses too) refuse those in HLS
 * unless this is turned off.
 *
 * mpv reports its playback position through its JSON IPC pipe (see
 * watchMpvProgress), so watch progress is saved like in the built-in player.
 * ffplay has no such interface, so it can't report progress.
 */

const crypto = require('crypto');
const net = require('net');
const os = require('os');
const path = require('path');
const {launchDetached, requireHttpUrl} = require('./process');

/** How often mpv's position is passed on, in ms. */
const PROGRESS_INTERVAL_MS = 5000;

/**
 * @typedef {{url: string, subtitleUrl: ?string, title: string, startAt: number}}
 * - url: absolute stream URL (HLS playlist or video file).
 * - startAt: seconds to resume from; 0 to start at the beginning.
 */
let ExternalPlayRequest;

/**
 * Opens a stream in the first player found on PATH.
 * Returns once the player has started; it then runs on its own.
 * @param {!ExternalPlayRequest} request
 * @param {function(number, number)} onProgress Called with (position, duration)
 *     in seconds while mpv plays, and once more when it closes.
 * @return {!Promise<string>} Name of the player that was started.
 * @throws {Error} If neither mpv nor ffplay is installed.
 */
async function playExternally(request, onProgress) {
  requireHttpUrl(request.url);
  if (request.subtitleUrl) requireHttpUrl(request.subtitleUrl);
  const ipcPath = createIpcPath();
  try {
    await launchDetached('mpv', buildMpvArgs(request, ipcPath));
    watchMpvProgress(ipcPath, onProgress);
    return 'mpv';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    // ponytail: ffplay has no subtitles or progress; install mpv for both.
    await launchDetached('ffplay', buildFfplayArgs(request));
    return 'ffplay';
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('No player found: install mpv (or ffmpeg for ffplay), or use the built-in player');
    }
    throw error;
  }
}

/** @return {string} A unique named pipe (Windows) or socket path (macOS/Linux). */
function createIpcPath() {
  const name = `ani-cli-gui-${crypto.randomBytes(6).toString('hex')}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
}

/**
 * @param {!ExternalPlayRequest} request
 * @param {string} ipcPath
 * @return {!Array<string>}
 */
function buildMpvArgs({url, subtitleUrl, title, startAt}, ipcPath) {
  return [
    `--input-ipc-server=${ipcPath}`,
    '--demuxer-lavf-o=extension_picky=0',
    ...(startAt > 0 ? [`--start=${Math.floor(startAt)}`] : []),
    ...(subtitleUrl ? [`--sub-file=${subtitleUrl}`] : []),
    `--force-media-title=${title}`,
    url,
  ];
}

/**
 * @param {!ExternalPlayRequest} request
 * @return {!Array<string>}
 */
function buildFfplayArgs({url, title, startAt}) {
  return [
    '-loglevel', 'error',
    '-extension_picky', '0',
    ...(startAt > 0 ? ['-ss', String(Math.floor(startAt))] : []),
    '-window_title', title,
    url,
  ];
}

/**
 * Connects to mpv's IPC pipe and reports the playback position.
 *
 * mpv's protocol is newline-separated JSON. `observe_property` makes mpv send a
 * `property-change` event whenever the property changes; time-pos changes many
 * times a second, so reports are throttled to PROGRESS_INTERVAL_MS. The pipe
 * closes when mpv exits, which triggers a last report.
 *
 * @param {string} ipcPath
 * @param {function(number, number)} onProgress
 * @param {number=} attempt mpv creates the pipe shortly after starting, so the
 *     first connections may fail; retried for about 5 seconds.
 */
function watchMpvProgress(ipcPath, onProgress, attempt = 0) {
  let position = 0;
  let duration = 0;
  let lastReport = 0;
  let buffer = '';
  const report = () => {
    if (duration > 0) onProgress(position, duration);
  };

  const socket = net.connect(ipcPath);
  socket.on('connect', () => {
    socket.write('{"command":["observe_property",1,"time-pos"]}\n');
    socket.write('{"command":["observe_property",2,"duration"]}\n');
  });
  socket.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep a partial line for the next chunk.
    for (const line of lines) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.event !== 'property-change' || typeof message.data !== 'number') continue;
      if (message.name === 'time-pos') position = message.data;
      if (message.name === 'duration') duration = message.data;
      if (Date.now() - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = Date.now();
        report();
      }
    }
  });
  socket.on('error', (error) => {
    if (error.code === 'ENOENT' && attempt < 50 && !position) {
      setTimeout(() => watchMpvProgress(ipcPath, onProgress, attempt + 1), 100);
    }
  });
  socket.on('close', report);
}

module.exports = {playExternally};
