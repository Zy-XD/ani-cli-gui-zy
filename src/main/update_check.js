/**
 * @fileoverview On start, asks GitHub for the latest release and offers to open
 * its page if it's newer than this build. The app is a portable .exe, which
 * electron-updater can't replace in place, so updating is a manual download.
 * Any failure (offline, no release yet, rate limit) is silent.
 */

const LATEST_RELEASE_URL = 'https://api.github.com/repos/Zy-XD/ani-cli-gui-zy/releases/latest';

/**
 * @param {string} latest e.g. 'v0.3.0'
 * @param {string} current e.g. '0.2.1'
 * @return {boolean} True if `latest` is a higher major.minor.patch.
 */
function isNewer(latest, current) {
  const parse = (version) => String(version).replace(/^v/, '').split('.').map((part) => parseInt(part, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

/**
 * @param {!import('electron').BrowserWindow} window Owns the dialog.
 * @return {!Promise<void>}
 */
async function checkForUpdate(window) {
  const {app, dialog, shell} = require('electron');
  if (!app.isPackaged) return; // Dev builds run from source, not from releases.
  try {
    const response = await fetch(LATEST_RELEASE_URL, {headers: {Accept: 'application/vnd.github+json'}});
    if (!response.ok) return;
    const {tag_name: tag, html_url: url} = await response.json();
    if (!tag || !isNewer(tag, app.getVersion()) || window.isDestroyed()) return;
    const {response: choice} = await dialog.showMessageBox(window, {
      type: 'info',
      message: `ani-cli GUI ${tag} is available`,
      detail: `You have ${app.getVersion()}. Updates include security fixes for the built-in browser and player.`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0 && url.startsWith('https://github.com/')) await shell.openExternal(url);
  } catch {
    // Offline or GitHub unreachable: try again next start.
  }
}

module.exports = {checkForUpdate, isNewer};
