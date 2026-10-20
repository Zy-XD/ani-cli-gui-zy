/**
 * @fileoverview Library page: saved series with where you left off.
 */

import {createAnimeCard} from './anime_card.js';
import {createElement, createEmptyMessage} from './dom.js';
import {formatTime, getLastWatched, isWatched, listSaved} from './library.js';

const libraryElement = document.getElementById('library');

/**
 * Redraws the library.
 * @param {{
 *   onOpen: function(!import('./library.js').LibraryEntry),
 *   onContinue: function(!import('./library.js').LibraryEntry),
 *   getSourceName: function(string): ?string,
 * }} handlers
 *   - onOpen: card clicked; show its episodes.
 *   - onContinue: Continue button clicked; play where the user left off.
 *   - getSourceName: name for a source key, or null if the source is offline.
 */
export function renderLibrary({onOpen, onContinue, getSourceName}) {
  const entries = listSaved();
  if (!entries.length) {
    libraryElement.replaceChildren(
        createEmptyMessage('Nothing saved yet. Open a series and press ☆ Save.'));
    return;
  }
  libraryElement.replaceChildren(...entries.map((entry) => {
    const sourceName = getSourceName(entry.sourceKey) || 'Source offline';
    const continueButton = createElement('button', {
      textContent: '▶ Continue',
      onclick: (event) => {
        event.stopPropagation(); // Don't also trigger the card's onOpen.
        onContinue(entry);
      },
    });
    const anime = {title: entry.title, poster: entry.poster};
    return createAnimeCard(anime, `${describeProgress(entry)} · ${sourceName}`,
        () => onOpen(entry), continueButton);
  }));
}

/**
 * @param {!import('./library.js').LibraryEntry} entry
 * @return {string} e.g. 'Ep 3 · 12:34', 'Ep 3 ✓', 'Not started'.
 */
function describeProgress(entry) {
  const last = getLastWatched(entry);
  if (!last) return 'Not started';
  const {number, position} = last.progress;
  return isWatched(last.progress) ? `Ep ${number} ✓` : `Ep ${number} · ${formatTime(position)}`;
}
