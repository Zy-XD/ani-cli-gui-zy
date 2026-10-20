/**
 * @fileoverview Browse page: source picker, search box and results grid.
 */

import {createAnimeCard} from './anime_card.js';
import {createElement, createEmptyMessage} from './dom.js';

const sourceSelect = document.getElementById('source-select');
const resultsElement = document.getElementById('results');

/**
 * Fills the source picker, keeping the current choice if it still exists.
 * @param {!Array<!import('./sources/node_client.js').ClientSource>} sources
 * @param {string} preferredKey Selected if present (e.g. the last used source).
 */
export function renderSourceOptions(sources, preferredKey) {
  const current = sourceSelect.value || preferredKey;
  sourceSelect.replaceChildren(...sources.map((source) => createElement('option', {
    value: source.key,
    textContent: `${source.name} · ${source.nodeName}`,
  })));
  if (sources.some((source) => source.key === current)) sourceSelect.value = current;
}

/** @return {string} Key of the selected source ('' if there are none). */
export function getSelectedSourceKey() {
  return sourceSelect.value;
}

/**
 * Replaces the grid with search results.
 * @param {!Array<!Object>} results Anime from the source.
 * @param {function(!Object)} onSelect Called with the clicked anime.
 */
export function renderResults(results, onSelect) {
  if (!results.length) {
    resultsElement.replaceChildren(createEmptyMessage('No results.'));
    return;
  }
  resultsElement.replaceChildren(...results.map((anime) =>
    createAnimeCard(anime, anime.info || '', () => onSelect(anime))));
}
