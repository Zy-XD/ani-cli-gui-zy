/**
 * @fileoverview Minimal HTTP helpers shared by the scraper, player and downloader.
 * Uses the global `fetch` (Node 18+ / Electron), so no HTTP library is needed.
 */

/**
 * Desktop Chrome user agent (the same one ani-cli sends). The site and its CDN
 * reject requests that look like bots, so every request and every external tool
 * (mpv, ffplay, ffmpeg) sends this.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Builds request headers with the user agent and an optional referer.
 * @param {string=} referer Needed for CDN requests (see StreamLinks.referer).
 * @return {!Object<string, string>}
 */
function buildHeaders(referer) {
  return referer ? {'User-Agent': USER_AGENT, 'Referer': referer} : {'User-Agent': USER_AGENT};
}

/**
 * Fetches a URL as text.
 * @param {string} url
 * @param {string=} referer
 * @return {!Promise<string>}
 * @throws {Error} On a non-2xx response, or when Cloudflare serves its
 *     "Just a moment" challenge page instead of content.
 */
async function fetchText(url, referer) {
  const response = await fetch(url, {headers: buildHeaders(referer)});
  const text = await response.text();
  // Checked before the status: the challenge page comes back as 403/503.
  if (/<title>Just a moment/i.test(text)) throw new Error('Blocked by Cloudflare');
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return text;
}

module.exports = {USER_AGENT, buildHeaders, fetchText};
