/**
 * @fileoverview The library: saved series and watch progress, kept in localStorage.
 *
 * Progress is recorded for every series you watch, saved or not, so saving a
 * series later keeps its history. Only saved series appear on the Library page.
 *
 * Stored shape (key 'library'):
 *   {
 *     '<sourceKey>|<animeId>': {
 *       sourceKey, animeId, title, poster, saved, updatedAt,
 *       episodes: {'<episodeId>': {number, position, duration, updatedAt}},
 *     },
 *   }
 * Times are seconds; updatedAt is a Date.now() timestamp.
 */

import {readJson, writeJson} from './storage.js';

const STORAGE_KEY = 'library';

/** An episode counts as watched past this fraction of its length (credits are skipped). */
const WATCHED_FRACTION = 0.9;

/**
 * @typedef {{number: string, position: number, duration: number, updatedAt: number}}
 */
let EpisodeProgress;

/**
 * @typedef {{
 *   sourceKey: string,
 *   animeId: string,
 *   title: string,
 *   poster: (string|undefined),
 *   saved: boolean,
 *   updatedAt: number,
 *   episodes: !Object<string, !EpisodeProgress>,
 * }}
 */
let LibraryEntry;

/** @type {!Object<string, !LibraryEntry>} */
let entries = readJson(STORAGE_KEY, {});

/**
 * @param {string} sourceKey
 * @param {string} animeId
 * @return {string}
 */
function entryKey(sourceKey, animeId) {
  return `${sourceKey}|${animeId}`;
}

/**
 * Gets or creates the entry for a series (not saved to disk until changed).
 * @param {string} sourceKey
 * @param {{id: string, title: string, poster: (string|undefined)}} anime
 * @return {!LibraryEntry}
 */
function ensureEntry(sourceKey, anime) {
  const key = entryKey(sourceKey, anime.id);
  entries[key] ||= {
    sourceKey, animeId: anime.id, title: anime.title, poster: anime.poster,
    saved: false, updatedAt: Date.now(), episodes: {},
  };
  return entries[key];
}

function persist() {
  writeJson(STORAGE_KEY, entries);
}

/**
 * @param {string} sourceKey
 * @param {string} animeId
 * @return {?LibraryEntry}
 */
export function getEntry(sourceKey, animeId) {
  return entries[entryKey(sourceKey, animeId)] || null;
}

/**
 * Adds a series to the library or removes it (its progress is kept either way).
 * @param {string} sourceKey
 * @param {{id: string, title: string, poster: (string|undefined)}} anime
 * @param {boolean} saved
 */
export function setSaved(sourceKey, anime, saved) {
  const entry = ensureEntry(sourceKey, anime);
  entry.saved = saved;
  entry.updatedAt = Date.now();
  persist();
}

/**
 * Records how far an episode was watched.
 * @param {string} sourceKey
 * @param {{id: string, title: string, poster: (string|undefined)}} anime
 * @param {{id: string, number: string}} episode
 * @param {number} position Seconds.
 * @param {number} duration Seconds.
 */
export function recordProgress(sourceKey, anime, episode, position, duration) {
  if (!(duration > 0)) return;
  const entry = ensureEntry(sourceKey, anime);
  entry.episodes[episode.id] = {number: episode.number, position, duration, updatedAt: Date.now()};
  entry.updatedAt = Date.now();
  persist();
}

/**
 * @param {?EpisodeProgress|undefined} progress
 * @return {boolean}
 */
export function isWatched(progress) {
  return Boolean(progress) && progress.position >= progress.duration * WATCHED_FRACTION;
}

/**
 * Where to resume an episode: its saved position, or 0 if unwatched or finished.
 * @param {?EpisodeProgress|undefined} progress
 * @return {number} Seconds.
 */
export function getResumePosition(progress) {
  return progress && !isWatched(progress) ? progress.position : 0;
}

/**
 * The most recently watched episode of a series.
 * @param {!LibraryEntry} entry
 * @return {?{episodeId: string, progress: !EpisodeProgress}}
 */
export function getLastWatched(entry) {
  let latest = null;
  for (const [episodeId, progress] of Object.entries(entry.episodes)) {
    if (!latest || progress.updatedAt > latest.progress.updatedAt) latest = {episodeId, progress};
  }
  return latest;
}

/** @return {!Array<!LibraryEntry>} Saved series, most recently active first. */
export function listSaved() {
  return Object.values(entries)
    .filter((entry) => entry.saved)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Formats seconds as m:ss or h:mm:ss.
 * @param {number} seconds
 * @return {string}
 */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}
