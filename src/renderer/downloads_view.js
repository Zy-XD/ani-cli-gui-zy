/**
 * @fileoverview Downloads list (#downloads): one row per job with a progress
 * bar, its status and a cancel button while it's still active.
 * Rows stay after a job finishes, so the user can see what was downloaded.
 */

import {createElement} from './dom.js';

/** Statuses after which a job can no longer be cancelled (see downloader.js). */
const FINISHED_STATUSES = new Set(['done', 'error', 'cancelled']);

const downloadsElement = document.getElementById('downloads');

/** @type {!Map<string, !HTMLElement>} Row of each job, by job id. */
const rowsById = new Map();

/**
 * Creates the row for a new job, or redraws an existing one.
 * @param {!import('../main/downloader').DownloadUpdate} update
 * @param {function(string)} onCancel Called with the job id.
 */
export function renderDownloadUpdate(update, onCancel) {
  let row = rowsById.get(update.id);
  if (!row) {
    row = downloadsElement.appendChild(createElement('div', {className: 'download'}));
    rowsById.set(update.id, row);
  }
  // '' renders nothing, so finished rows have no cancel button.
  const cancelButton = FINISHED_STATUSES.has(update.status) ? '' :
    createElement('button', {textContent: '✕', title: 'Cancel', onclick: () => onCancel(update.id)});
  const statusText = update.status === 'downloading' ?
    `downloading ${update.percent}%` : update.status;
  row.replaceChildren(
      createElement('div', {className: 'download-header'},
          createElement('span', {textContent: update.name}), cancelButton),
      createElement('progress', {max: 100, value: update.percent}),
      createElement('div', {
        className: update.error ? 'error' : '',
        textContent: update.error || statusText,
      }));
}
