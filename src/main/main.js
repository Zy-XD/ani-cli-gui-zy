/**
 * @fileoverview Electron entry point (package.json "main").
 *
 * Process layout:
 * - Main process (src/main): scraping, spawning mpv/ffplay/ffmpeg, file system.
 * - Preload (src/preload): exposes a small `window.aniApi` over IPC.
 * - Renderer (src/renderer): the UI, with no Node access.
 */

const {app, BrowserWindow} = require('electron');
const path = require('path');
const {registerIpcHandlers} = require('./ipc');
const {loadSettings} = require('./settings');

app.whenReady().then(() => {
  // Electron's defaults (contextIsolation on, nodeIntegration off, sandboxed
  // renderer) are kept, so the page only reaches Node through the preload.
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#111318', // Matches --background in styles.css, so the window doesn't flash white.
    autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, '../preload/preload.js')},
  });
  registerIpcHandlers(window, loadSettings());
  window.loadFile(path.join(__dirname, '../renderer/index.html'));
});

// One window only, so closing it quits the app on every platform (macOS included).
app.on('window-all-closed', () => app.quit());
