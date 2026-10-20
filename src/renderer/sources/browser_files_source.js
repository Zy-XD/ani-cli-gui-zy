/**
 * @fileoverview "Files on this device": plays a folder of videos picked in the
 * browser, with no node needed. Works on the hosted web app too.
 *
 * Browsers only give access to files the user picks, and forget them on reload,
 * so the folder has to be picked again after reloading the page.
 */

import {groupIntoSeries} from '../shared/media_files.mjs';

/** @type {!Map<string, !File>} Picked files by relative path ('Folder/Show/Ep 1.mp4' -> 'Show/Ep 1.mp4'). */
let filesByPath = new Map();

/** @type {!Map<string, string>} Object URLs handed out, revoked when a new folder is picked. */
const objectUrls = new Map();

/**
 * Replaces the picked files (from an `<input type="file" webkitdirectory>`).
 * @param {!FileList} fileList
 * @return {number} How many videos were found.
 */
export function setPickedFiles(fileList) {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  filesByPath = new Map([...fileList].map((file) => {
    // Drop the picked folder's own name so paths are relative to it.
    const relativePath = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
    return [relativePath, file];
  }));
  return groupIntoSeries([...filesByPath.keys()])
    .reduce((count, series) => count + series.episodes.length, 0);
}

/**
 * @param {string} path
 * @return {?string} An object URL for a picked file, or null if it isn't picked.
 */
function getObjectUrl(path) {
  const file = filesByPath.get(path);
  if (!file) return null;
  if (!objectUrls.has(path)) objectUrls.set(path, URL.createObjectURL(file));
  return objectUrls.get(path);
}

/** @return {!Array<!Object>} */
function listSeries() {
  return groupIntoSeries([...filesByPath.keys()]);
}

/** @type {!import('./node_client.js').ClientSource} */
export const browserFilesSource = {
  key: 'browser#files',
  name: 'Files on this device',
  nodeName: 'This browser',
  description: 'Videos from a folder you pick. Pick it again after reloading the page.',
  modes: [],
  downloadable: false,

  async search(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return listSeries()
      .filter((series) => words.every((word) => series.title.toLowerCase().includes(word)))
      .map((series) => ({id: series.id, title: series.title, info: `${series.episodes.length} files`}));
  },

  async getEpisodes(seriesId) {
    const series = listSeries().find((candidate) => candidate.id === seriesId);
    if (!series) throw new Error('Pick the folder again on the Sources page');
    return series.episodes;
  },

  async getStream(episodeId) {
    const url = getObjectUrl(episodeId);
    if (!url) throw new Error('Pick the folder again on the Sources page');
    return {type: 'file', url, subtitleUrl: getObjectUrl(episodeId.replace(/\.[^.]+$/, '.vtt'))};
  },

  getDownloadRequest: undefined,
};
