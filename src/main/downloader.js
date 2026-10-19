/**
 * @fileoverview Download queue: saves an episode as <name>.mp4 (+ <name>.vtt subtitles).
 *
 * The stream is HLS, so ffmpeg fetches the playlist and its segments and
 * remuxes them into an MP4 with `-c copy` (no re-encoding, so it's fast and
 * lossless). aria2 isn't used because it can't read HLS playlists.
 *
 * Job lifecycle (each change is sent to the renderer as a DownloadUpdate):
 *
 *   queued -> resolving -> downloading -> done
 *                 \             \
 *                  `-------------`-----> error | cancelled
 *
 * A job can be cancelled at any point before it finishes. Partial files of
 * cancelled jobs are deleted.
 */

const fs = require('fs');
const path = require('path');
const {USER_AGENT, buildHeaders} = require('../scraper/http');
const {getStreamLinks, pickStream} = require('../scraper/hianime');
const {getPlaylistDuration} = require('../scraper/playlist');
const {launchProcess} = require('./process');

/** Statuses a job never leaves. */
const FINISHED_STATUSES = new Set(['done', 'error', 'cancelled']);

/**
 * What the renderer asks to download.
 * @typedef {{episodeId: string, mode: string, quality: string, name: string}}
 * - mode: 'sub' or 'dub'.
 * - quality: e.g. '720p' or 'best'.
 * - name: file name without extension; unsafe characters are replaced.
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
 * Replaces characters Windows forbids in file names (the same set ani-cli replaces).
 * @param {string} name
 * @return {string}
 */
function toSafeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_');
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
  }

  /**
   * Adds a download to the end of the queue.
   * @param {!DownloadRequest} request
   * @return {string} Job id, for cancel().
   */
  enqueue(request) {
    const job = {
      id: `${request.episodeId}-${request.mode}-${Date.now()}`,
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
   * Downloads one job. The stream is resolved only now, because stream URLs
   * expire and the job may have waited in the queue.
   * Never rejects: failures are reported as status 'error'.
   * @param {!DownloadJob} job
   * @return {!Promise<void>}
   * @private
   */
  async run_(job) {
    if (job.status === 'cancelled') return;
    this.update_(job, {status: 'resolving'});
    const outputDir = this.getDownloadDir_();
    const basePath = path.join(outputDir, job.name);
    try {
      const {episodeId, mode, quality} = job.request;
      const links = await getStreamLinks(episodeId, mode);
      const {url} = pickStream(links.streams, quality);
      fs.mkdirSync(outputDir, {recursive: true});
      if (links.subtitleUrl) await downloadFile(links.subtitleUrl, links.referer, `${basePath}.vtt`);
      // ffmpeg doesn't know the total length up front; the playlist does.
      const totalSeconds = getPlaylistDuration(await fetchWithReferer(url, links.referer));
      // The user may have cancelled while the links were resolving.
      if (job.status === 'cancelled') return removeFiles(basePath);

      const exitCode = await this.runFfmpeg_(job, url, links.referer, `${basePath}.mp4`, totalSeconds);
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
   * @param {string} url Variant playlist.
   * @param {string} referer
   * @param {string} outputPath .mp4 path; overwritten if it exists.
   * @param {number} totalSeconds Playlist length; 0 when unknown (no progress shown).
   * @return {!Promise<number>} ffmpeg exit code (non-zero only when cancelled).
   * @throws {Error} With ffmpeg's last error line if it fails on its own.
   * @private
   */
  async runFfmpeg_(job, url, referer, outputPath, totalSeconds) {
    const child = await launchProcess('ffmpeg', [
      '-y', '-nostdin', '-loglevel', 'error',
      '-extension_picky', '0', // Segments are named .ts.jpg; see player.js.
      '-user_agent', USER_AGENT,
      '-referer', referer,
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
 * Fetches a CDN URL (which needs the referer) as text.
 * @param {string} url
 * @param {string} referer
 * @return {!Promise<string>}
 */
async function fetchWithReferer(url, referer) {
  return (await fetch(url, {headers: buildHeaders(referer)})).text();
}

/**
 * Saves a URL to disk. Best effort: an HTTP error is ignored, since a missing
 * subtitle file shouldn't fail the whole download.
 * @param {string} url
 * @param {string} referer
 * @param {string} outputPath
 * @return {!Promise<void>}
 */
async function downloadFile(url, referer, outputPath) {
  const response = await fetch(url, {headers: buildHeaders(referer)});
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
