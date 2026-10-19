/**
 * @fileoverview Preload script: the only bridge between the UI and Node.
 *
 * It exposes `window.aniApi`, a fixed set of functions that each call one IPC
 * channel (see src/main/ipc.js), instead of raw ipcRenderer access, so the page
 * can't send arbitrary messages to the main process.
 */

const {contextBridge, ipcRenderer} = require('electron');

/**
 * Makes a function that calls a main-process handler and returns its result.
 * @param {string} channel
 * @return {function(*=): !Promise<*>}
 */
const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('aniApi', {
  /** (query) -> Promise<Anime[]> */
  search: invoke('search'),
  /** (animeId) -> Promise<Episode[]> */
  getEpisodes: invoke('get-episodes'),
  /** ({episodeId, mode, quality, title}) -> Promise<player name> */
  play: invoke('play'),
  /** ({episodeId, mode, quality, name}) -> Promise<job id> */
  download: invoke('download'),
  /** (jobId) -> Promise<void> */
  cancelDownload: invoke('cancel-download'),
  /** () -> Promise<path> */
  getDownloadDir: invoke('get-download-dir'),
  /** () -> Promise<path>; opens a folder picker. */
  chooseDownloadDir: invoke('choose-download-dir'),
  /** () -> Promise; opens the folder in Explorer. */
  openDownloadDir: invoke('open-download-dir'),
  /**
   * Subscribes to download progress.
   * @param {function({id: string, name: string, status: string, percent: number,
   *     error: (string|undefined)})} callback
   */
  onDownloadUpdate: (callback) => {
    // Only the payload is passed on; the IPC event object stays in the preload.
    ipcRenderer.on('download-update', (event, update) => callback(update));
  },
});
