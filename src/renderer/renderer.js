/**
 * @fileoverview Renderer entry point: connects the views to `window.aniApi`.
 *
 * Flow: search -> pick an anime (episodes load) -> play or download episodes.
 * Each view module owns one part of the page; this file holds the app state
 * (the selected anime) and turns user actions into API calls.
 *
 * Types such as Anime and Episode are documented in src/scraper/hianime.js.
 */

import {renderDownloadUpdate} from './downloads_view.js';
import {renderEpisodes, setAnimeTitle} from './episodes_view.js';
import {renderResults} from './results_view.js';
import {runWithStatus, setStatus} from './status_bar.js';

/** Bridge from src/preload/preload.js. */
const api = window.aniApi;

/** @type {?import('../scraper/hianime').Anime} Anime whose episodes are shown. */
let currentAnime = null;

/**
 * Reads the Sub/Dub and quality pickers in the header.
 * @return {{mode: string, quality: string}}
 */
function getPlaybackOptions() {
  return {
    mode: document.getElementById('mode').value,
    quality: document.getElementById('quality').value,
  };
}

/**
 * Display name, also used as the player title and download file name.
 * @param {!import('../scraper/hianime').Episode} episode
 * @return {string} e.g. "Frieren: Beyond Journey's End Episode 1".
 */
function getEpisodeName(episode) {
  return `${currentAnime.title} Episode ${episode.number}`;
}

/**
 * Runs a search from the header form and shows the results.
 * @param {!Event} event Form submit event.
 */
async function handleSearch(event) {
  event.preventDefault(); // Stop the form from reloading the page.
  const query = document.getElementById('query').value.trim();
  if (!query) return;
  const results = await runWithStatus(`Searching "${query}"…`, () => api.search(query));
  if (results) renderResults(results, selectAnime);
}

/**
 * Shows the episodes of the clicked anime.
 * @param {!import('../scraper/hianime').Anime} anime
 */
async function selectAnime(anime) {
  currentAnime = anime;
  setAnimeTitle(anime.title);
  const episodes = await runWithStatus('Loading episodes…', () => api.getEpisodes(anime.id));
  // If another anime was clicked while this one loaded, drop this response.
  if (episodes && currentAnime === anime) {
    renderEpisodes(episodes, {onPlay: playEpisode, onDownload: downloadEpisode});
  }
}

/**
 * Opens an episode in the external player.
 * @param {!import('../scraper/hianime').Episode} episode
 */
async function playEpisode(episode) {
  const title = getEpisodeName(episode);
  const player = await runWithStatus(`Fetching ${title}…`,
      () => api.play({episodeId: episode.episodeId, title, ...getPlaybackOptions()}));
  if (player) setStatus(`Playing in ${player}`);
}

/**
 * Queues an episode for download. Progress arrives through onDownloadUpdate.
 * @param {!import('../scraper/hianime').Episode} episode
 * @return {!Promise<string|undefined>} Job id, or undefined on error.
 */
function downloadEpisode(episode) {
  const options = getPlaybackOptions();
  // Keep sub and dub files of the same episode from overwriting each other.
  const suffix = options.mode === 'dub' ? ' (Dub)' : '';
  return runWithStatus('Queueing…', () => api.download({
    episodeId: episode.episodeId,
    name: getEpisodeName(episode) + suffix,
    ...options,
  }));
}

// Wire up the static controls in index.html.
document.getElementById('search-form').addEventListener('submit', handleSearch);
document.getElementById('choose-dir-button').addEventListener('click', async () => {
  setStatus(`Downloads: ${await api.chooseDownloadDir()}`);
});
document.getElementById('open-dir-button').addEventListener('click', () => api.openDownloadDir());
api.onDownloadUpdate((update) => renderDownloadUpdate(update, api.cancelDownload));
api.getDownloadDir().then((dir) => setStatus(`Downloads: ${dir}`));
