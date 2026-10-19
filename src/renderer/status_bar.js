/**
 * @fileoverview Status line at the bottom of the window (#status). Shows what's
 * in progress ("Searching…"), and errors in red.
 */

const statusElement = document.getElementById('status');

/**
 * @param {string} message Empty string clears the line.
 * @param {boolean=} isError Shows the message in red.
 */
export function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', isError);
}

/**
 * Shows `message` while `task` runs. On success, clears the line and returns
 * the result. On failure, shows the error instead of throwing, so callers only
 * need to check for undefined.
 * @template T
 * @param {string} message
 * @param {function(): !Promise<T>} task
 * @return {!Promise<T|undefined>} Undefined if the task failed.
 */
export async function runWithStatus(message, task) {
  setStatus(message);
  try {
    const result = await task();
    setStatus('');
    return result;
  } catch (error) {
    setStatus(stripIpcPrefix(error.message), true);
    return undefined;
  }
}

/**
 * Removes the prefix Electron adds to errors from the main process, e.g.
 * "Error invoking remote method 'play': Error: No player found" -> "No player found".
 * @param {string} message
 * @return {string}
 */
function stripIpcPrefix(message) {
  return message.replace(/^Error invoking remote method '[\w-]+': (Error: )?/, '');
}
