/**
 * @fileoverview JSON values in localStorage, under an 'ani-cli-gui.' prefix.
 *
 * localStorage persists in both the desktop app and the browser. Reads and
 * writes are wrapped because storage can be unavailable (private windows,
 * blocked site data); the app then works but forgets everything on reload.
 */

const PREFIX = 'ani-cli-gui.';

/**
 * @template T
 * @param {string} key
 * @param {T} fallback Returned when the key is missing or unreadable.
 * @return {T}
 */
export function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {*} value
 */
export function writeJson(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full: keep running without saving.
  }
}
