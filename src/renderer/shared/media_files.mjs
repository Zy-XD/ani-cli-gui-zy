/**
 * @fileoverview Groups video files into series and episodes. Shared by two sources:
 * the node's "Local files" source (src/sources/local) and the browser's
 * "Files on this device" source (src/renderer/sources).
 *
 * This file lives under src/renderer so the static web build can serve it. Node
 * loads it with require(), which works for ES modules on Node 22.12 and later.
 */

/** File extensions treated as playable video. */
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.ts'];

/** Matches "<title> Episode 12", "<title> - Ep 12", "<title>_E12.5", and so on. */
const EPISODE_PATTERN = /^(.*?)[\s._-]*(?:episode|ep|e)[\s._-]*(\d+(?:\.\d+)?)(?!\d)/i;

/**
 * A series built from files.
 * @typedef {{
 *   id: string,
 *   title: string,
 *   episodes: !Array<{id: string, number: string, title: string}>,
 * }}
 * - id: the series title, unique within one folder.
 * - episodes[].id: the file's path relative to the folder, with '/' separators.
 */
let FileSeries;

/**
 * @param {string} path
 * @return {boolean}
 */
export function isVideoFile(path) {
  const lower = path.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Splits a relative path into series title and episode number.
 * A file inside a subfolder belongs to the series named after that folder (the
 * downloader saves files that way). Loose files are grouped by the title before
 * "Episode N" in their name.
 * @param {string} relativePath Path with '/' separators, e.g. 'Frieren/Frieren Episode 1.mp4'.
 * @return {{seriesTitle: string, number: ?string, fileTitle: string}}
 */
export function parseEpisodePath(relativePath) {
  const parts = relativePath.split('/');
  const fileTitle = parts[parts.length - 1].replace(/\.[^.]+$/, '');
  const match = fileTitle.match(EPISODE_PATTERN);
  const folder = parts.length > 1 ? parts[parts.length - 2] : null;
  const seriesTitle = folder || (match && match[1].trim()) || fileTitle;
  return {seriesTitle, number: match ? match[2] : null, fileTitle};
}

/**
 * Groups video files into series. Episodes without a number in their name are
 * numbered by their position in natural sort order.
 * @param {!Array<string>} relativePaths Paths with '/' separators; non-videos are ignored.
 * @return {!Array<!FileSeries>} Sorted by title.
 */
export function groupIntoSeries(relativePaths) {
  const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
  const byTitle = new Map();
  for (const path of relativePaths.filter(isVideoFile).sort(collator.compare)) {
    const {seriesTitle, number, fileTitle} = parseEpisodePath(path);
    if (!byTitle.has(seriesTitle)) byTitle.set(seriesTitle, []);
    const episodes = byTitle.get(seriesTitle);
    episodes.push({id: path, number: number || String(episodes.length + 1), title: fileTitle});
  }
  return [...byTitle]
    .map(([title, episodes]) => ({id: title, title, episodes}))
    .sort((a, b) => collator.compare(a.title, b.title));
}
