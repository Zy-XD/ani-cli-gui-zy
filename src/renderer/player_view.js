/**
 * @fileoverview Built-in player: a full-window <video> that plays HLS through
 * hls.js (loaded as window.Hls from vendor/hls.min.js) and plain files natively.
 * Reports the position so the library can track progress.
 */

const playerElement = document.getElementById('player');
const videoElement = document.getElementById('player-video');
const titleElement = document.getElementById('player-title');
const nextButton = document.getElementById('player-next');
const closeButton = document.getElementById('player-close');

/** How often the position is reported while playing, in ms. */
const PROGRESS_INTERVAL_MS = 5000;

/** @type {?Object} The hls.js instance of the current video, if any. */
let hls = null;

/** @type {?function(number, number)} Progress callback of the current video. */
let reportProgress = null;

let lastReport = 0;

/**
 * Sends the current position, if the video has a known length.
 */
function report() {
  if (reportProgress && videoElement.duration > 0 && Number.isFinite(videoElement.duration)) {
    reportProgress(videoElement.currentTime, videoElement.duration);
  }
}

videoElement.addEventListener('timeupdate', () => {
  if (Date.now() - lastReport >= PROGRESS_INTERVAL_MS) {
    lastReport = Date.now();
    report();
  }
});
videoElement.addEventListener('pause', report);
videoElement.addEventListener('ended', report);
closeButton.addEventListener('click', closePlayer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !playerElement.hidden) closePlayer();
});

/**
 * Opens the player.
 * @param {{
 *   title: string,
 *   stream: {type: string, url: string, subtitleUrl: ?string},
 *   startAt: number,
 *   onProgress: function(number, number),
 *   onNext: ?function(),
 *   onError: function(string),
 * }} options
 *   - startAt: seconds to resume from.
 *   - onNext: plays the next episode; null hides the button.
 */
export function openPlayer({title, stream, startAt, onProgress, onNext, onError}) {
  closePlayer();
  titleElement.textContent = title;
  nextButton.hidden = !onNext;
  nextButton.onclick = onNext;
  reportProgress = onProgress;
  playerElement.hidden = false;

  if (stream.subtitleUrl) {
    videoElement.append(Object.assign(document.createElement('track'), {
      kind: 'subtitles', label: 'Subtitles', srclang: 'en', src: stream.subtitleUrl, default: true,
    }));
  }
  if (stream.type === 'hls' && window.Hls && window.Hls.isSupported()) {
    // hls.js picks its first segment itself, so a seek on loadedmetadata would be
    // overridden; startPosition makes it start loading at the resume point.
    hls = new window.Hls({startPosition: startAt > 0 ? startAt : -1});
    hls.on(window.Hls.Events.ERROR, (event, data) => {
      if (data.fatal) onError(`Playback failed: ${data.details}`);
    });
    hls.loadSource(stream.url);
    hls.attachMedia(videoElement);
  } else {
    // Plain files, or Safari, which plays HLS natively.
    videoElement.addEventListener('loadedmetadata', () => {
      if (startAt > 0) videoElement.currentTime = startAt;
    }, {once: true});
    videoElement.src = stream.url;
  }
  videoElement.onerror = () => onError('This video can\'t be played here. Try mpv in the desktop app.');
}

/** Saves the position, stops playback and hides the player. */
export function closePlayer() {
  report();
  reportProgress = null;
  if (hls) {
    hls.destroy();
    hls = null;
  }
  videoElement.onerror = null;
  videoElement.pause();
  videoElement.removeAttribute('src');
  videoElement.replaceChildren(); // Drop the previous subtitle track.
  videoElement.load();
  playerElement.hidden = true;
}
