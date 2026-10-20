/**
 * @fileoverview Preload script: the only bridge between the UI and Node.
 *
 * It exposes `window.aniApi` with the desktop-only features (external players,
 * downloads, folders). The web app runs without it and hides those features.
 * Each function calls one IPC channel (see src/main/ipc.js); the page gets no
 * raw ipcRenderer access, so it can't send arbitrary messages to the main process.
 */

const {contextBridge, ipcRenderer} = require('electron');

/**
 * Makes a function that calls a main-process handler and returns its result.
 * @param {string} channel
 * @return {function(*=): !Promise<*>}
 */
const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

/**
 * Makes a subscribe function for a main -> renderer event.
 * Only the payload is passed on; the IPC event object stays in the preload.
 * @param {string} channel
 * @return {function(function(*))}
 */
const subscribe = (channel) => (callback) => {
  ipcRenderer.on(channel, (event, payload) => callback(payload));
};

contextBridge.exposeInMainWorld('aniApi', {
  /** () -> Promise<url> of the app's own node. */
  getEmbeddedNode: invoke('get-embedded-node'),
  /** ({token, url, subtitleUrl, title, startAt}) -> Promise<player name> */
  playExternal: invoke('play-external'),
  /** ({apiBase, streamPath, folder, name}) -> Promise<job id> */
  download: invoke('download'),
  /** (jobId) -> Promise<void> */
  cancelDownload: invoke('cancel-download'),
  /** () -> Promise<path> */
  getDownloadDir: invoke('get-download-dir'),
  /** () -> Promise<path>; opens a folder picker. */
  chooseDownloadDir: invoke('choose-download-dir'),
  /** () -> Promise; opens the download folder in the file manager. */
  openDownloadDir: invoke('open-download-dir'),
  /** () -> Promise; opens the drop-in sources folder in the file manager. */
  openSourcesDir: invoke('open-sources-dir'),
  /** (callback({id, name, status, percent, error})) */
  onDownloadUpdate: subscribe('download-update'),
  /** (callback({token, position, duration})) while mpv plays. */
  onPlaybackProgress: subscribe('playback-progress'),
});
