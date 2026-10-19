/**
 * @fileoverview Persists user settings as JSON in Electron's userData folder
 * (on Windows: %APPDATA%\<app name>\settings.json).
 */

const {app} = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * @typedef {{downloadDir: string}}
 * - downloadDir: where downloads are saved. Defaults to <Downloads>/ani-cli.
 */
let Settings;

/** @return {string} Absolute path of the settings file. */
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * Loads the saved settings on top of the defaults.
 * Call after app 'ready', since app.getPath needs it.
 * @return {!Settings}
 */
function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch {
    // First run or unreadable file: use the defaults.
  }
  return {downloadDir: path.join(app.getPath('downloads'), 'ani-cli'), ...saved};
}

/**
 * Writes all settings to disk (synchronously; the file is tiny).
 * @param {!Settings} settings
 */
function saveSettings(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings));
}

module.exports = {loadSettings, saveSettings};
