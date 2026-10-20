/**
 * @fileoverview Electron entry point (package.json "main").
 *
 * Process layout:
 * - Main process (src/main): runs the app's own node (src/server) on
 *   127.0.0.1, plus what a browser can't do: mpv/ffplay and ffmpeg downloads.
 * - Preload (src/preload): exposes a small `window.aniApi` over IPC.
 * - Renderer (src/renderer): the UI, the same code as the web app. It talks to
 *   nodes over HTTP and uses `window.aniApi` when present.
 */

const {app, BrowserWindow} = require('electron');
const path = require('path');
const {loadSources} = require('../sources/registry');
const {createNodeServer} = require('../server/server');
const {registerIpcHandlers} = require('./ipc');
const {loadSettings} = require('./settings');

/**
 * Starts the embedded node on a free port, reachable from this computer only.
 * Its "Local files" source reads the download folder.
 * @param {!import('./settings').Settings} settings
 * @param {string} sourcesDir
 * @return {!Promise<string>} The node's URL.
 */
function startEmbeddedNode(settings, sourcesDir) {
  const sources = loadSources({getLocalDir: () => settings.downloadDir, extensionsDir: sourcesDir});
  const server = createNodeServer({name: 'This computer', sources});
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

app.whenReady().then(async () => {
  const settings = loadSettings();
  const sourcesDir = path.join(app.getPath('userData'), 'sources');
  const nodeUrl = await startEmbeddedNode(settings, sourcesDir);

  // Electron's defaults (contextIsolation on, nodeIntegration off, sandboxed
  // renderer) are kept, so the page only reaches Node through the preload.
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#111318', // Matches --background in styles.css, so the window doesn't flash white.
    autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, '../preload/preload.js')},
  });
  registerIpcHandlers(window, settings, {nodeUrl, sourcesDir});
  window.loadFile(path.join(__dirname, '../renderer/index.html'));
});

// One window only, so closing it quits the app on every platform (macOS included).
app.on('window-all-closed', () => app.quit());
