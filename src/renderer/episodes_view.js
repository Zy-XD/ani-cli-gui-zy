/**
 * @fileoverview Episode list of the selected anime (right panel), with
 * play/download buttons per episode and a "Download all" button.
 */

import {createElement} from './dom.js';

const titleElement = document.getElementById('anime-title');
const episodesElement = document.getElementById('episodes');
const downloadAllButton = document.getElementById('download-all-button');

/**
 * Sets the panel heading. Called before episodes load, so it updates at once.
 * @param {string} title
 */
export function setAnimeTitle(title) {
  titleElement.textContent = title;
}

/**
 * Replaces the list with new episodes.
 * @param {!Array<!import('../scraper/hianime').Episode>} episodes
 * @param {{
 *   onPlay: function(!import('../scraper/hianime').Episode),
 *   onDownload: function(!import('../scraper/hianime').Episode),
 * }} handlers
 */
export function renderEpisodes(episodes, {onPlay, onDownload}) {
  downloadAllButton.hidden = !episodes.length;
  // Overwritten (not added) each time, so it always downloads the current list.
  downloadAllButton.onclick = () => episodes.forEach(onDownload);
  episodesElement.replaceChildren(...episodes.map((episode) =>
    createElement('div', {className: 'episode'},
        createElement('span', {
          className: 'episode-title',
          textContent: `${episode.number}. ${episode.title}`,
          title: episode.title, // Shows the full name when it's cut off.
        }),
        createElement('button', {textContent: '▶', title: 'Play', onclick: () => onPlay(episode)}),
        createElement('button', {
          textContent: '⬇',
          title: 'Download',
          onclick: () => onDownload(episode),
        }))));
}
