/**
 * @fileoverview Episode list of the selected series (right panel): watch
 * progress per episode, play/download buttons, "Save to library" and "Download all".
 */

import {createElement, createEmptyMessage} from './dom.js';
import {formatTime, isWatched} from './library.js';

const titleElement = document.getElementById('anime-title');
const episodesElement = document.getElementById('episodes');
const saveButton = document.getElementById('save-button');
const downloadAllButton = document.getElementById('download-all-button');

/**
 * Shows a series title and an empty list while its episodes load.
 * @param {string} title
 */
export function showLoading(title) {
  titleElement.textContent = title;
  saveButton.hidden = true;
  downloadAllButton.hidden = true;
  episodesElement.replaceChildren(createEmptyMessage('Loading…'));
}

/**
 * Replaces the list with a series' episodes.
 * @param {{
 *   title: string,
 *   episodes: !Array<{id: string, number: string, title: string}>,
 *   progress: !Object<string, !import('./library.js').EpisodeProgress>,
 *   saved: boolean,
 *   canDownload: boolean,
 *   onPlay: function(!Object),
 *   onDownload: function(!Object),
 *   onToggleSave: function(),
 * }} options
 *   - progress: by episode id; episodes without an entry are unwatched.
 *   - canDownload: show download buttons (desktop app and a downloadable source).
 */
export function renderEpisodes(options) {
  const {title, episodes, progress, saved, canDownload, onPlay, onDownload, onToggleSave} = options;
  titleElement.textContent = title;
  saveButton.hidden = false;
  saveButton.textContent = saved ? '★ Saved' : '☆ Save';
  saveButton.title = saved ? 'Remove from library' : 'Add to library';
  saveButton.onclick = onToggleSave;
  downloadAllButton.hidden = !canDownload || !episodes.length;
  // Overwritten (not added) each time, so it always downloads the current list.
  downloadAllButton.onclick = () => episodes.forEach(onDownload);

  if (!episodes.length) {
    episodesElement.replaceChildren(createEmptyMessage('No episodes.'));
    return;
  }
  episodesElement.replaceChildren(...episodes.map((episode) => {
    const episodeProgress = progress[episode.id];
    const watched = isWatched(episodeProgress);
    return createElement('div', {className: watched ? 'episode watched' : 'episode'},
        createElement('span', {
          className: 'episode-title',
          textContent: `${episode.number}. ${episode.title}`,
          title: episode.title, // Shows the full name when it's cut off.
        }),
        createElement('span', {
          className: 'episode-progress',
          textContent: watched ? '✓' : episodeProgress ? formatTime(episodeProgress.position) : '',
          title: episodeProgress ?
            `${formatTime(episodeProgress.position)} / ${formatTime(episodeProgress.duration)}` : '',
        }),
        createElement('button', {textContent: '▶', title: 'Play', onclick: () => onPlay(episode)}),
        canDownload ? createElement('button', {
          textContent: '⬇',
          title: 'Download',
          onclick: () => onDownload(episode),
        }) : '');
  }));
}
