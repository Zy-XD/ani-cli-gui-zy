/**
 * @fileoverview IPC handlers the renderer calls through `window.aniApi`.
 *
 * Channels (renderer -> main, via ipcRenderer.invoke):
 *   search               (query: string)            -> Anime[]
 *   get-episodes         (animeId: string)          -> Episode[]
 *   play                 (PlayRequest)              -> 'mpv' | 'ffplay'
 *   download             (DownloadRequest)          -> job id
 *   cancel-download      (jobId: string)            -> void
 *   get-download-dir     ()                         -> path
 *   choose-download-dir  ()                         -> path (unchanged if cancelled)
 *   open-download-dir    ()                         -> '' or an error message
 *
 * Events (main -> renderer, via webContents.send):
 *   download-update      (DownloadUpdate)           every time a job changes
 *
 * An error thrown by a handler is passed to the renderer as a rejected promise.
 */

const {dialog, ipcMain, shell} = require('electron');
const fs = require('fs');
const {search, getEpisodes} = require('../scraper/hianime');
const {DownloadQueue} = require('./downloader');
const {playEpisode} = require('./player');
const {saveSettings} = require('./settings');

/**
 * Registers every handler. Call once, after the window is created.
 * @param {!import('electron').BrowserWindow} window Receives download updates and
 *     owns the folder picker dialog.
 * @param {!import('./settings').Settings} settings Live settings object; changed
 *     here when the user picks a new download folder.
 */
function registerIpcHandlers(window, settings) {
  // The folder is read when each job starts, so a change applies to queued jobs too.
  const downloads = new DownloadQueue(
      () => settings.downloadDir,
      (update) => window.webContents.send('download-update', update));

  ipcMain.handle('search', (event, query) => search(query));
  ipcMain.handle('get-episodes', (event, animeId) => getEpisodes(animeId));
  ipcMain.handle('play', (event, request) => playEpisode(request));
  ipcMain.handle('download', (event, request) => downloads.enqueue(request));
  ipcMain.handle('cancel-download', (event, id) => downloads.cancel(id));

  ipcMain.handle('get-download-dir', () => settings.downloadDir);
  ipcMain.handle('open-download-dir', () => {
    // Create it first so the button works before the first download.
    fs.mkdirSync(settings.downloadDir, {recursive: true});
    return shell.openPath(settings.downloadDir);
  });
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

module.exports = {registerIpcHandlers};
