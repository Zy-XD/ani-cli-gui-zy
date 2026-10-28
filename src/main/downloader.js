/**
 * @fileoverview Download queue: saves an episode as <folder>/<name>.mp4 (+ .vtt subtitles).
 *
 * Episodes are fetched through a node (the app's own or a remote one): the job
 * asks the node for the stream when it starts, then ffmpeg reads the node's
 * proxied HLS playlist and remuxes it into an MP4 with `-c copy` (no
 * re-encoding, so it's fast and lossless). aria2 isn't used because it can't
 * read HLS playlists.
 *
 * Each series gets its own folder, which the "Local files" source reads as one
 * series, so downloads can be played offline.
 *
 * Job lifecycle (each change is sent to the renderer as a DownloadUpdate):
 *
 *   queued -> resolving -> downloading -> done
 *                 \             \
 *                  `-------------`-----> error | cancelled
 *
 * A job can be cancelled any time before it finishes. Partial files of
 * cancelled jobs are deleted.
 */

const fs = require('fs');
const path = require('path');
const {getPlaylistDuration} = require('../sources/hianime/playlist');
const {launchProcess, requireHttpUrl} = require('./process');

/** Statuses a job never leaves. */
const FINISHED_STATUSES = new Set(['done', 'error', 'cancelled']);

/**
 * What the renderer asks to download.
 * @typedef {{apiBase: string, streamPath: string, folder: string, name: string}}
 * - apiBase: the node's API root, ending in '/api/'.
 * - streamPath: stream request relative to apiBase, e.g. 'sources/hianime/stream?...'.
 * - folder: series title, used as the subfolder name.
 * - name: file name without extension. Unsafe characters in folder and name are replaced.
 */
let DownloadRequest;

/**
 * Snapshot of a job sent to the renderer.
 * @typedef {{
 *   id: string,
 *   name: string,
 *   status: string,
 *   percent: number,
 *   error: (string|undefined),
 * }}
 * - status: one of queued, resolving, downloading, done, error, cancelled.
 * - percent: 0-100; stays below 100 until ffmpeg exits successfully.
 * - error: set when status is 'error'.
 */
let DownloadUpdate;

/**
 * Internal job state: a DownloadUpdate plus what's needed to run and cancel it.
 * @typedef {{
 *   id: string,
 *   name: string,
 *   status: string,
 *   percent: number,
 *   error: (string|undefined),
 *   request: !DownloadRequest,
 *   process: ?import('child_process').ChildProcess,
 * }}
 */
let DownloadJob;

/**
 * Makes a title safe as one file or folder name inside the download folder:
 * replaces characters Windows forbids (the same set ani-cli replaces) and
 * control characters, trims trailing dots and spaces (Windows drops them), and
 * renames '', '.', '..' and reserved device names (CON, NUL, COM1, ...), so a
 * title from a source can never point outside its folder.
 * @param {string} name
 * @return {string}
 */
function toSafeFileName(name) {
  const safe = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  return !safe || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(safe) ? `_${safe}` : safe;
}

/**
 * Runs downloads one at a time, in the order they were added.
 *
 * The queue is a promise chain: each new job is chained after the previous one,
 * so no explicit worker loop is needed.
 */
class DownloadQueue {
  /**
   * @param {function(): string} getDownloadDir Read when each job starts, so a
   *     folder change also applies to jobs already queued.
   * @param {function(!DownloadUpdate)} onUpdate Called on every job change.
   */
  constructor(getDownloadDir, onUpdate) {
    /** @private @const */
    this.getDownloadDir_ = getDownloadDir;
    /** @private @const */
    this.onUpdate_ = onUpdate;
    /** @private @const {!Map<string, !DownloadJob>} Every job ever added, by id. */
    this.jobs_ = new Map();
    // ponytail: one download at a time; parallel workers if bandwidth is left idle.
    /** @private {!Promise<void>} Resolves when the last queued job finishes. */
    this.tail_ = Promise.resolve();
    /** @private {number} Makes ids unique when many jobs are added at once. */
    this.nextId_ = 1;
  }

  /**
   * Adds a download to the end of the queue.
   * @param {!DownloadRequest} request
   * @return {string} Job id, for cancel().
   */
  enqueue(request) {
    const job = {
      id: String(this.nextId_++),
      name: toSafeFileName(request.name),
      status: 'queued',
      percent: 0,
      error: undefined,
      request,
      process: null,
    };
    this.jobs_.set(job.id, job);
    this.update_(job, {}); // Show the row as 'queued' right away.
    // run_ never rejects (it reports errors through the job), so the chain never breaks.
    this.tail_ = this.tail_.then(() => this.run_(job));
    return job.id;
  }

  /**
   * Cancels a queued or running job. Does nothing for unknown or finished jobs.
   * A queued job is skipped when its turn comes; a running ffmpeg is killed.
   * @param {string} id
   */
  cancel(id) {
    const job = this.jobs_.get(id);
    if (!job || FINISHED_STATUSES.has(job.status)) return;
    this.update_(job, {status: 'cancelled'});
    if (job.process) job.process.kill();
  }

  /**
   * Applies changes to a job and sends its new state to the renderer.
   * @param {!DownloadJob} job
   * @param {!Object} changes Fields of DownloadUpdate to change.
   * @private
   */
  update_(job, changes) {
    Object.assign(job, changes);
    const {id, name, status, percent, error} = job;
    this.onUpdate_({id, name, status, percent, error});
  }

  /**
   * Downloads one job. The stream is requested only now, because stream URLs
   * expire and the job may have waited in the queue.
   * Never rejects: failures are reported as status 'error'.
   * @param {!DownloadJob} job
   * @return {!Promise<void>}
   * @private
   */
  async run_(job) {
    if (job.status === 'cancelled') return;
    this.update_(job, {status: 'resolving'});
    const outputDir = path.join(this.getDownloadDir_(), toSafeFileName(job.request.folder));
    const basePath = path.join(outputDir, job.name);
    try {
      const {apiBase, streamPath} = job.request;
      const stream = await fetchJson(new URL(streamPath, requireHttpUrl(apiBase)));
      if (stream.type !== 'hls') throw new Error('This source can\'t be downloaded');
      const url = requireHttpUrl(new URL(stream.url, apiBase).href);
      fs.mkdirSync(outputDir, {recursive: true});
      if (stream.subtitleUrl) {
        await downloadFile(requireHttpUrl(new URL(stream.subtitleUrl, apiBase).href), `${basePath}.vtt`);
      }
      // ffmpeg doesn't know the total length up front; the playlist does.
      const totalSeconds = getPlaylistDuration(await (await fetch(url)).text());
      // The user may have cancelled while the stream was resolving.
      if (job.status === 'cancelled') return removeFiles(basePath);

      const exitCode = await this.runFfmpeg_(job, url, `${basePath}.mp4`, totalSeconds);
      if (job.status === 'cancelled') {
        removeFiles(basePath);
      } else if (exitCode === 0) {
        this.update_(job, {status: 'done', percent: 100});
      }
    } catch (error) {
      const message = error.code === 'ENOENT' ? 'ffmpeg not found on PATH' : error.message;
      this.update_(job, {status: 'error', error: message});
    }
  }

  /**
   * Runs ffmpeg for one job and reports its progress.
   *
   * `-progress pipe:1` makes ffmpeg write `key=value` lines to stdout about
   * twice a second; `out_time_us` (microseconds written so far) divided by the
   * playlist length gives the percentage.
   *
   * @param {!DownloadJob} job
   * @param {string} url Proxied media playlist.
   * @param {string} outputPath .mp4 path; overwritten if it exists.
   * @param {number} totalSeconds Playlist length; 0 when unknown (no progress shown).
   * @return {!Promise<number>} ffmpeg exit code (non-zero only when cancelled).
   * @throws {Error} With ffmpeg's last error line if it fails on its own.
   * @private
   */
  async runFfmpeg_(job, url, outputPath, totalSeconds) {
    const child = await launchProcess('ffmpeg', [
      '-y', '-nostdin', '-loglevel', 'error',
      '-extension_picky', '0', // Proxied segment URLs have no extension; see player.js.
      '-i', url,
      '-c', 'copy',
      '-progress', 'pipe:1',
      outputPath,
    ]);
    job.process = child;
    this.update_(job, {status: 'downloading'});

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      // A chunk may hold several progress blocks; the last one is the newest.
      const times = String(chunk).match(/out_time_us=\d+/g);
      if (!times || !totalSeconds) return;
      const seconds = Number(times.pop().split('=')[1]) / 1e6;
      // Capped at 99 so 100% means the file is complete.
      this.update_(job, {percent: Math.min(99, Math.round((seconds / totalSeconds) * 100))});
    });

    const exitCode = await new Promise((resolve) => child.on('close', resolve));
    if (exitCode !== 0 && job.status !== 'cancelled') {
      const lastLine = stderr.trim().split('\n').pop();
      throw new Error(lastLine || `ffmpeg exited with code ${exitCode}`);
    }
    return exitCode;
  }
}

/**
 * @param {!URL} url
 * @return {!Promise<*>}
 * @throws {Error} With the node's error message on failure.
 */
async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

/**
 * Saves a URL to disk. Best effort: an HTTP error is ignored, since a missing
 * subtitle file shouldn't fail the whole download.
 * @param {string} url
 * @param {string} outputPath
 * @return {!Promise<void>}
 */
async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (response.ok) fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
}

/**
 * Deletes a job's partial files, if any.
 * @param {string} basePath Path without extension.
 */
function removeFiles(basePath) {
  for (const extension of ['.mp4', '.vtt']) fs.rmSync(basePath + extension, {force: true});
}

module.exports = {DownloadQueue, toSafeFileName};
