/**
 * @fileoverview IPC handlers for what only the desktop app can do. Everything
 * else (search, episodes, streams) goes over HTTP to a node, the same way as in
 * the browser.
 *
 * Channels (renderer -> main, via ipcRenderer.invoke):
 *   get-embedded-node    ()                         -> the app's own node URL
 *   play-external        (ExternalPlayRequest)      -> 'mpv' | 'ffplay'
 *   download             (DownloadRequest)          -> job id
 *   cancel-download      (jobId: string)            -> void
 *   get-download-dir     ()                         -> path
 *   choose-download-dir  ()                         -> path (unchanged if cancelled)
 *   open-download-dir    ()                         -> '' or an error message
 *   open-sources-dir     ()                         -> '' or an error message
 *
 * Events (main -> renderer, via webContents.send):
 *   download-update      (DownloadUpdate)           every time a job changes
 *   playback-progress    ({token, position, duration})  while mpv plays
 *
 * An error thrown by a handler is passed to the renderer as a rejected promise.
 */

const {dialog, ipcMain, shell} = require('electron');
const fs = require('fs');
const {DownloadQueue} = require('./downloader');
const {playExternally} = require('./player');
const {saveSettings} = require('./settings');

/**
 * Registers every handler. Call once, after the window is created.
 * @param {!import('electron').BrowserWindow} window Receives events and owns dialogs.
 * @param {!import('./settings').Settings} settings Live settings object; changed
 *     here when the user picks a new download folder.
 * @param {{nodeUrl: string, sourcesDir: string}} paths
 *     - nodeUrl: the embedded node with its key, e.g. 'http://127.0.0.1:51234/<key>'.
 *     - sourcesDir: folder of drop-in sources for the embedded node.
 */
function registerIpcHandlers(window, settings, {nodeUrl, sourcesDir}) {
  const send = (channel, payload) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };
  // The folder is read when each job starts, so a change applies to queued jobs too.
  const downloads = new DownloadQueue(
      () => settings.downloadDir,
      (update) => send('download-update', update));

  ipcMain.handle('get-embedded-node', () => nodeUrl);
  ipcMain.handle('play-external', (event, {token, ...request}) =>
    playExternally(request, (position, duration) =>
      send('playback-progress', {token, position, duration})));
  ipcMain.handle('download', (event, request) => downloads.enqueue(request));
  ipcMain.handle('cancel-download', (event, id) => downloads.cancel(id));

  ipcMain.handle('get-download-dir', () => settings.downloadDir);
  ipcMain.handle('open-download-dir', () => openFolder(settings.downloadDir));
  ipcMain.handle('open-sources-dir', () => openFolder(sourcesDir));
  ipcMain.handle('choose-download-dir', async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.downloadDir,
    });
    if (!result.canceled) {
      settings.downloadDir = result.filePaths[0];
      saveSettings(settings);
    }
    return settings.downloadDir;
  });
}

/**
 * Opens a folder in the file manager, creating it first so the button always works.
 * @param {string} folder
 * @return {!Promise<string>} '' on success, else an error message.
 */
function openFolder(folder) {
  fs.mkdirSync(folder, {recursive: true});
  return shell.openPath(folder);
}

module.exports = {registerIpcHandlers};
