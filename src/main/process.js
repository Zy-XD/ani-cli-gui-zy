/**
 * @fileoverview Helpers for starting external tools (mpv, ffplay, ffmpeg).
 * Arguments are passed as an array with no shell, so titles and URLs are never
 * interpreted by a shell.
 */

const {spawn} = require('child_process');

/**
 * Spawns a process and waits until it has actually started.
 * child_process.spawn reports a missing binary asynchronously (an 'error'
 * event); this turns it into a rejected promise so callers can try a fallback.
 * @param {string} command Executable name, looked up on PATH.
 * @param {!Array<string>} args
 * @param {!Object=} options Passed to child_process.spawn.
 * @return {!Promise<!import('child_process').ChildProcess>}
 * @throws {Error} With `code === 'ENOENT'` when the binary isn't on PATH.
 */
function launchProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('spawn', () => resolve(child));
  });
}

/**
 * Starts a process that keeps running after the app quits (e.g. a video
 * player), with its output discarded.
 * @param {string} command
 * @param {!Array<string>} args
 * @return {!Promise<void>} Resolves once the process has started.
 */
async function launchDetached(command, args) {
  const child = await launchProcess(command, args, {detached: true, stdio: 'ignore'});
  // Let the app's event loop exit without waiting for the child.
  child.unref();
}

module.exports = {launchProcess, launchDetached};
