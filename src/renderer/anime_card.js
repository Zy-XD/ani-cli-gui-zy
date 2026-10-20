/**
 * @fileoverview Poster card used by the search results and the library.
 */

import {createElement} from './dom.js';

/**
 * @param {{title: string, poster: (string|undefined)}} anime
 * @param {string} info Grey line under the title.
 * @param {function()} onSelect Called on click; the card is highlighted first.
 * @param {...!Node} extras Extra elements at the bottom (e.g. a Continue button).
 * @return {!HTMLElement}
 */
export function createAnimeCard(anime, info, onSelect, ...extras) {
  // Sources without artwork (local files) get a placeholder.
  const poster = anime.poster ?
    createElement('img', {src: anime.poster, loading: 'lazy', alt: ''}) :
    createElement('div', {className: 'poster-placeholder', textContent: '🎞'});
  const card = createElement('div', {className: 'anime-card'},
      poster,
      createElement('div', {className: 'anime-card-info', textContent: anime.title},
          createElement('small', {textContent: info})),
      ...extras);
  card.onclick = () => {
    // Highlight only the clicked card, across every grid.
    for (const selected of document.querySelectorAll('.anime-card.selected')) {
      selected.classList.remove('selected');
    }
    card.classList.add('selected');
    onSelect();
  };
  return card;
}
