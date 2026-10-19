/**
 * @fileoverview Search results: a grid of poster cards (#results).
 */

import {createElement, createEmptyMessage} from './dom.js';

const resultsElement = document.getElementById('results');

/**
 * Replaces the grid with new results.
 * @param {!Array<!import('../scraper/hianime').Anime>} results
 * @param {function(!import('../scraper/hianime').Anime)} onSelect Called when a card is clicked.
 */
export function renderResults(results, onSelect) {
  if (!results.length) {
    resultsElement.replaceChildren(createEmptyMessage('No results.'));
    return;
  }
  resultsElement.replaceChildren(...results.map((anime) => createCard(anime, onSelect)));
}

/**
 * Builds one card: poster, title, and sub/dub episode counts.
 * @param {!import('../scraper/hianime').Anime} anime
 * @param {function(!import('../scraper/hianime').Anime)} onSelect
 * @return {!HTMLElement}
 */
function createCard(anime, onSelect) {
  const card = createElement('div', {className: 'anime-card'},
      createElement('img', {src: anime.poster || '', loading: 'lazy', alt: ''}),
      createElement('div', {className: 'anime-card-info', textContent: anime.title},
          createElement('small', {textContent: `Sub ${anime.subCount} · Dub ${anime.dubCount}`})));
  card.onclick = () => {
    // Highlight only the clicked card.
    for (const selected of resultsElement.querySelectorAll('.selected')) {
      selected.classList.remove('selected');
    }
    card.classList.add('selected');
    onSelect(anime);
  };
  return card;
}
