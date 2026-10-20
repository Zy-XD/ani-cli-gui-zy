/**
 * @fileoverview "Local files" source: plays videos from a folder on the node's disk.
 * In the Electron app this is the download folder, so downloads show up here.
 *
 * Series and episode ids are paths relative to the folder (see media_files.mjs).
 * Every path is checked to stay inside the folder before it's used.
 */

const fs = require('fs');
const path = require('path');
const {groupIntoSeries} = require('../../renderer/shared/media_files.mjs');

/**
 * @param {function(): string} getRoot Folder to read, looked up on every call so
 *     a changed setting applies immediately.
 * @return {!import('../source').Source}
 */
function createLocalSource(getRoot) {
  /** @return {!Array<!Object>} Every series in the folder. */
  const listSeries = () => {
    const root = getRoot();
    if (!fs.existsSync(root)) return [];
    // ponytail: rescans the folder on every request; cache if folders get huge.
    const files = fs.readdirSync(root, {recursive: true})
      .map((file) => String(file).split(path.sep).join('/'));
    return groupIntoSeries(files);
  };

  /**
   * Resolves a relative path, refusing anything outside the folder.
   * @param {string} relativePath
   * @return {string} Absolute path.
   */
  const resolveInside = (relativePath) => {
    const root = path.resolve(getRoot());
    const absolute = path.resolve(root, relativePath);
    if (!absolute.startsWith(root + path.sep)) throw new Error('Path is outside the folder');
    return absolute;
  };

  return {
    id: 'local',
    name: 'Local files',
    description: 'Videos in this node\'s folder (the download folder in the app).',

    async search(query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return listSeries()
        .filter((series) => words.every((word) => series.title.toLowerCase().includes(word)))
        .map((series) => ({
          id: series.id,
          title: series.title,
          info: `${series.episodes.length} file${series.episodes.length === 1 ? '' : 's'}`,
        }));
    },

    async getEpisodes(seriesId) {
      const series = listSeries().find((candidate) => candidate.id === seriesId);
      if (!series) throw new Error(`"${seriesId}" is no longer in the folder`);
      return series.episodes;
    },

    async getStream(episodeId) {
      const videoPath = resolveInside(episodeId);
      if (!fs.existsSync(videoPath)) throw new Error('File not found');
      // A subtitle saved next to the video with the same name (the downloader does this).
      const subtitlePath = videoPath.replace(/\.[^.]+$/, '.vtt');
      return {
        type: 'file',
        path: videoPath,
        subtitlePath: fs.existsSync(subtitlePath) ? subtitlePath : null,
      };
    },
  };
}

module.exports = {createLocalSource};
