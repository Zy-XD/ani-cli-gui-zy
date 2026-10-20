/**
 * @fileoverview Renderer entry point: holds the app state and connects the views,
 * the sources and the library.
 *
 * The same code runs in the desktop app and in a browser. `window.aniApi` (set
 * by the desktop app's preload) adds mpv and downloads; without it, those
 * controls are hidden.
 *
 * Flow: pick a source -> search -> open a series (episodes + progress) ->
 * play (built-in player or mpv) or download. Progress is saved to the library
 * as you watch; ☆ Save adds the series to the Library page.
 */

import {getSelectedSourceKey, renderResults, renderSourceOptions} from './browse_view.js';
import {renderDownloadUpdate} from './downloads_view.js';
import {renderEpisodes, showLoading} from './episodes_view.js';
import {getEntry, getLastWatched, getResumePosition, isWatched, recordProgress, setSaved}
  from './library.js';
import {renderLibrary} from './library_view.js';
import {openPlayer} from './player_view.js';
import {setPickedFiles} from './sources/browser_files_source.js';
import {addNode, findSource, getNodes, getSources, initSources, refreshSources, removeNode}
  from './sources/source_manager.js';
import {renderSourcesPage} from './sources_view.js';
import {runWithStatus, setStatus} from './status_bar.js';
import {readJson, writeJson} from './storage.js';

/** Desktop-only API from src/preload/preload.js; undefined in a browser. */
const desktopApi = window.aniApi;

/** Header pickers whose values are remembered between sessions. */
const PREFERENCE_IDS = ['mode', 'quality', 'player-choice'];

/**
 * The series shown in the episode panel.
 * @type {?{source: !Object, anime: {id: string, title: string, poster: (string|undefined)},
 *     episodes: !Array<!Object>}}
 */
let current = null;

/** @type {?number} Videos in the folder picked for "Files on this device". */
let pickedFileCount = null;

/**
 * mpv progress arrives later as events; each play gets a token to find its episode.
 * @type {!Map<string, function(number, number)>}
 */
const externalProgressHandlers = new Map();

// ---------------------------------------------------------------------------
// Preferences and views

/** @return {{mode: string, quality: string}} The Sub/Dub and quality pickers. */
function getStreamOptions() {
  return {
    mode: document.getElementById('mode').value,
    quality: document.getElementById('quality').value,
  };
}

function restorePreferences() {
  const saved = readJson('preferences', {});
  for (const id of PREFERENCE_IDS) {
    const select = document.getElementById(id);
    if (saved[id]) select.value = saved[id];
    select.addEventListener('change', savePreferences);
  }
}

function savePreferences() {
  const values = Object.fromEntries(PREFERENCE_IDS.map((id) => [id, document.getElementById(id).value]));
  writeJson('preferences', {...values, sourceKey: getSelectedSourceKey()});
}

/**
 * Shows one page (browse, library or sources) and refreshes it.
 * @param {string} name
 */
function showView(name) {
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `${name}-view`;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.view === name);
  }
  if (name === 'library') refreshLibrary();
  if (name === 'sources') refreshSourcesPage();
}

function refreshLibrary() {
  renderLibrary({
    onOpen: (entry) => openLibraryEntry(entry),
    onContinue: (entry) => continueEntry(entry),
    getSourceName: (key) => findSource(key)?.name || null,
  });
}

function refreshSourcesPage() {
  renderSourcesPage({
    nodes: getNodes(),
    pickedFileCount,
    isDesktop: Boolean(desktopApi),
    onAddNode: (url) => updateSources(`Connecting to ${url}…`, () => addNode(url)),
    onRemoveNode: (url) => updateSources('Removing…', () => removeNode(url)),
    onRefresh: () => updateSources('Reconnecting…', refreshSources),
    onPickFolder: (files) => {
      pickedFileCount = setPickedFiles(files);
      refreshSourcesPage();
    },
    onOpenSourcesDir: () => desktopApi.openSourcesDir(),
  });
}

/**
 * Runs a change to the node list, then redraws everything that lists sources.
 * @param {string} message
 * @param {function(): !Promise<void>} change
 */
async function updateSources(message, change) {
  await runWithStatus(message, change);
  renderSourceOptions(getSources(), readJson('preferences', {}).sourceKey);
  refreshSourcesPage();
}

// ---------------------------------------------------------------------------
// Browsing and the episode panel

/** @param {!Event} event Search form submit. */
async function handleSearch(event) {
  event.preventDefault(); // Stop the form from reloading the page.
  savePreferences();
  const source = findSource(getSelectedSourceKey());
  if (!source) return setStatus('No source available. Add a node on the Sources page.', true);
  const query = document.getElementById('query').value.trim();
  const results = await runWithStatus(`Searching ${source.name}…`, () => source.search(query));
  if (results) renderResults(results, (anime) => openSeries(source, anime));
}

/**
 * Loads a series into the episode panel.
 * @param {!Object} source ClientSource.
 * @param {{id: string, title: string, poster: (string|undefined)}} anime
 * @return {!Promise<boolean>} False if the episodes couldn't be loaded.
 */
async function openSeries(source, anime) {
  current = {source, anime, episodes: []};
  const requested = current;
  showLoading(anime.title);
  const episodes = await runWithStatus('Loading episodes…', () => source.getEpisodes(anime.id));
  // If another series was opened while this one loaded, drop this response.
  if (!episodes || current !== requested) return false;
  current.episodes = episodes;
  renderCurrentEpisodes();
  return true;
}

/** Redraws the episode panel, e.g. after progress changed. */
function renderCurrentEpisodes() {
  if (!current) return;
  const {source, anime, episodes} = current;
  const entry = getEntry(source.key, anime.id);
  renderEpisodes({
    title: anime.title,
    episodes,
    progress: entry ? entry.episodes : {},
    saved: Boolean(entry && entry.saved),
    canDownload: Boolean(desktopApi && source.downloadable),
    onPlay: playEpisode,
    onDownload: downloadEpisode,
    onToggleSave: () => {
      setSaved(source.key, anime, !(entry && entry.saved));
      renderCurrentEpisodes();
    },
  });
}

// ---------------------------------------------------------------------------
// Library

/**
 * @param {!import('./library.js').LibraryEntry} entry
 * @return {?Object} The entry's source, or null (with an error shown) if it's offline.
 */
function findEntrySource(entry) {
  const source = findSource(entry.sourceKey);
  if (!source) setStatus('This series\' source is offline. Check the Sources page.', true);
  return source;
}

/** @param {!import('./library.js').LibraryEntry} entry */
function openLibraryEntry(entry) {
  const source = findEntrySource(entry);
  if (source) openSeries(source, {id: entry.animeId, title: entry.title, poster: entry.poster});
}

/**
 * Plays where the user left off: the last episode if unfinished, else the next one.
 * @param {!import('./library.js').LibraryEntry} entry
 */
async function continueEntry(entry) {
  const source = findEntrySource(entry);
  if (!source) return;
  if (!await openSeries(source, {id: entry.animeId, title: entry.title, poster: entry.poster})) return;
  const last = getLastWatched(entry);
  const lastIndex = last ? current.episodes.findIndex((episode) => episode.id === last.episodeId) : -1;
  const index = lastIndex < 0 ? 0 : isWatched(last.progress) ? lastIndex + 1 : lastIndex;
  const episode = current.episodes[index];
  if (episode) playEpisode(episode);
  else setStatus('You\'ve watched every episode.');
}

// ---------------------------------------------------------------------------
// Playing and downloading

/**
 * Plays an episode of the current series and records progress as it plays.
 * @param {!Object} episode
 */
async function playEpisode(episode) {
  const {source, anime, episodes} = current;
  const title = `${anime.title} · Episode ${episode.number}`;
  const stream = await runWithStatus(`Fetching ${title}…`,
      () => source.getStream(episode.id, getStreamOptions()));
  if (!stream) return;

  const entry = getEntry(source.key, anime.id);
  const startAt = getResumePosition(entry && entry.episodes[episode.id]);
  const onProgress = (position, duration) => {
    recordProgress(source.key, anime, episode, position, duration);
    if (current && current.anime === anime) renderCurrentEpisodes();
  };

  if (desktopApi && document.getElementById('player-choice').value === 'external') {
    const token = crypto.randomUUID();
    externalProgressHandlers.set(token, onProgress);
    const {url, subtitleUrl} = stream;
    const player = await runWithStatus('Starting player…',
        () => desktopApi.playExternal({token, url, subtitleUrl, title, startAt}));
    if (player) setStatus(`Playing in ${player}`);
    return;
  }
  const next = episodes[episodes.indexOf(episode) + 1];
  openPlayer({
    title,
    stream,
    startAt,
    onProgress,
    onNext: next ? () => playEpisode(next) : null,
    onError: (message) => setStatus(message, true),
  });
}

/**
 * Queues an episode of the current series for download (desktop only).
 * Files go to <download folder>/<series title>/.
 * @param {!Object} episode
 * @return {!Promise<string|undefined>} Job id, or undefined on error.
 */
function downloadEpisode(episode) {
  const {source, anime} = current;
  const options = getStreamOptions();
  // Keep sub and dub files of the same episode from overwriting each other.
  const suffix = options.mode === 'dub' && source.modes.includes('dub') ? ' (Dub)' : '';
  return runWithStatus('Queueing…', () => desktopApi.download({
    ...source.getDownloadRequest(episode.id, options),
    folder: anime.title,
    name: `${anime.title} Episode ${episode.number}${suffix}`,
  }));
}

// ---------------------------------------------------------------------------
// Startup

async function start() {
  for (const element of document.querySelectorAll('[data-desktop-only]')) {
    element.hidden = !desktopApi;
  }
  restorePreferences();
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  }
  document.getElementById('search-form').addEventListener('submit', handleSearch);
  document.getElementById('source-select').addEventListener('change', savePreferences);

  if (desktopApi) {
    document.getElementById('choose-dir-button').addEventListener('click', async () => {
      setStatus(`Downloads: ${await desktopApi.chooseDownloadDir()}`);
    });
    document.getElementById('open-dir-button').addEventListener('click', () => desktopApi.openDownloadDir());
    desktopApi.onDownloadUpdate((update) => renderDownloadUpdate(update, desktopApi.cancelDownload));
    desktopApi.onPlaybackProgress(({token, position, duration}) => {
      const handler = externalProgressHandlers.get(token);
      if (handler) handler(position, duration);
    });
  }

  showView('browse');
  await runWithStatus('Connecting to sources…', initSources);
  renderSourceOptions(getSources(), readJson('preferences', {}).sourceKey);
  if (!getNodes().length) {
    setStatus('No node connected yet: add one on the Sources page, or pick a folder of videos.');
  }
}

start();
