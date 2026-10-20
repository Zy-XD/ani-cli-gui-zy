/**
 * @fileoverview Port of ani-cli's hianime scraper (ani-cli 5.1.5).
 *
 * Resolving an episode to a playable stream takes five requests:
 *
 *   1. search      GET /search?keyword=<query>                -> HTML, one card per anime
 *   2. episodes    GET /api/theme/episode/list/<animeNumber>  -> JSON {html}, one item per episode
 *   3. servers     GET /api/theme/episode/servers?episodeId=  -> JSON {html}, one item per server
 *                  The chosen server's `data-hash` is the base64 of an embed page URL.
 *   4. embed page  GET <embed url>                            -> HTML with `window.__P="<blob>"`,
 *                  a base64 + XOR-obfuscated JSON player config (stream + subtitles).
 *   5. master      GET <config.src> (Referer: embed origin)   -> HLS master playlist (qualities).
 *
 * The site has no public API, so the HTML is read with regexes, like ani-cli's
 * sed scripts. When the site changes, compare this file with upstream's
 * hianime_* functions: https://github.com/pystardust/ani-cli/blob/master/ani-cli
 */

const {fetchText} = require('./http');
const {decodeEntities, readAttribute} = require('./html');
const {parseMasterPlaylist} = require('./playlist');

const BASE_URL = 'https://hianime.at';

/** The only server ani-cli supports; the others use different embed formats. */
const EMBED_SERVER_NAME = 'ZokoAnime';

/** Repeating XOR key the embed page uses to obfuscate its player config. */
const EMBED_XOR_KEY = Buffer.from('otaku-embed-v1');

/**
 * One search result.
 * @typedef {{
 *   id: string,
 *   title: string,
 *   poster: (string|undefined),
 *   subCount: number,
 *   dubCount: number,
 * }}
 * - id: URL slug ending in the site's numeric id, e.g. 'frieren-beyond-journeys-end-481'.
 * - poster: thumbnail image URL.
 * - subCount / dubCount: episodes released with subtitles / English audio.
 */
let Anime;

/**
 * One episode of an anime.
 * @typedef {{number: string, episodeId: string, title: string}}
 * - number: episode number as shown on the site (a string, since some are '12.5').
 * - episodeId: the site's internal id, used to look up servers.
 * - title: episode name, or '' when the site has none.
 */
let Episode;

/**
 * Everything a player or downloader needs to fetch an episode.
 * @typedef {{
 *   referer: string,
 *   subtitleUrl: ?string,
 *   streams: !Array<!import('./playlist').Stream>,
 * }}
 * - referer: must be sent with every playlist/segment request or the CDN returns 403.
 * - subtitleUrl: default WebVTT subtitle track, or null (e.g. for dubs).
 * - streams: one per quality, best first.
 */
let StreamLinks;

/**
 * Searches the catalogue.
 * @param {string} query Free text, e.g. 'one piece'.
 * @return {!Promise<!Array<!Anime>>} Results in the site's order (best match first).
 */
async function search(query) {
  const page = await fetchText(`${BASE_URL}/search?keyword=${encodeURIComponent(query)}`);
  // The sidebar ("top anime") uses the same card markup; cut it off so it isn't parsed as results.
  const html = page.split('id="main-sidebar"')[0];
  return html.split('<div class="flw-item').slice(1).map(parseSearchItem).filter(Boolean);
}

/**
 * Parses one search card.
 * @param {string} item HTML from one `flw-item` div up to the next.
 * @return {?Anime} Null if the card has no title link (not a real result).
 */
function parseSearchItem(item) {
  const link = item.match(/<h3 class="film-name">\s*<a href="[^"]*\/([^"/]*)"\s*title="([^"]*)"/);
  if (!link) return null;
  // Episode counts are badges like `<div class="tick-item tick-sub"><i ...></i>28</div>`.
  const readCount = (kind) => {
    const match = item.match(new RegExp(`tick-${kind}">(?:<i[^>]*></i>)?(\\d+)`));
    return match ? Number(match[1]) : 0;
  };
  return {
    id: link[1],
    title: decodeEntities(link[2]),
    poster: readAttribute(item, 'src'),
    subCount: readCount('sub'),
    dubCount: readCount('dub'),
  };
}

/**
 * Lists the episodes of an anime.
 * @param {string} animeId Slug from {@link Anime.id}.
 * @return {!Promise<!Array<!Episode>>} In episode order.
 */
async function getEpisodes(animeId) {
  // The API wants only the numeric suffix of the slug ('...-481' -> '481').
  const numericId = animeId.split('-').pop();
  const {html} = JSON.parse(await fetchText(`${BASE_URL}/api/theme/episode/list/${numericId}`));
  return html.split('ep-item').slice(1).map(parseEpisodeItem).filter(Boolean);
}

/**
 * Parses one episode link.
 * @param {string} item HTML from one `ep-item` up to the next.
 * @return {?Episode} Null if the item lacks a number or id.
 */
function parseEpisodeItem(item) {
  const number = readAttribute(item, 'data-number');
  const episodeId = readAttribute(item, 'data-id');
  if (!number || !episodeId) return null;
  const title = item.match(/class="ep-name[^"]*"[^>]*title="([^"]*)"/);
  return {number, episodeId, title: title ? decodeEntities(title[1]) : ''};
}

/**
 * Resolves the playable streams and subtitles of an episode (steps 3-5 above).
 * Stream URLs are signed and expire, so resolve right before playing or downloading.
 * @param {string} episodeId From {@link Episode.episodeId}.
 * @param {string=} mode 'sub' (Japanese audio + subtitles) or 'dub' (English audio).
 * @return {!Promise<!StreamLinks>}
 * @throws {Error} If the episode has no source for `mode`, or the site changed.
 */
async function getStreamLinks(episodeId, mode = 'sub') {
  const embedUrl = await getEmbedUrl(episodeId, mode);
  // The CDN only checks that the Referer is the embed site's origin.
  const referer = `${new URL(embedUrl).origin}/`;
  const payload = decodeEmbedPayload(await fetchText(embedUrl));
  const defaultSubtitle = (payload.subtitles || []).find((subtitle) => subtitle.default);
  const masterPlaylist = await fetchText(payload.src, referer);
  return {
    referer,
    subtitleUrl: defaultSubtitle ? defaultSubtitle.src : null,
    streams: parseMasterPlaylist(masterPlaylist, payload.src),
  };
}

/**
 * Finds the embed page URL for an episode (step 3 above).
 * @param {string} episodeId
 * @param {string} mode 'sub' or 'dub'.
 * @return {!Promise<string>} e.g. 'https://zokoanime.video/stream/mal/52991/1/sub'.
 */
async function getEmbedUrl(episodeId, mode) {
  const url = `${BASE_URL}/api/theme/episode/servers?episodeId=${episodeId}`;
  const {html} = JSON.parse(await fetchText(url));
  const server = html.split('server-item').find((item) =>
    readAttribute(item, 'data-type') === mode &&
    readAttribute(item, 'data-server-name') === EMBED_SERVER_NAME);
  const hash = server && readAttribute(server, 'data-hash');
  if (!hash) throw new Error(`No ${mode} source for this episode`);
  return Buffer.from(hash, 'base64').toString();
}

/**
 * Decodes the player config that the embed page hides in `window.__P`
 * (step 4 above): base64-decode, then XOR each byte with {@link EMBED_XOR_KEY}.
 * @param {string} embedPage HTML of the embed page.
 * @return {{src: string, subtitles: (!Array<{src: string, default: boolean}>|undefined)}}
 *     Only the fields used here; the config has many more (poster, skip times, ...).
 * @throws {Error} If the page no longer contains the blob.
 */
function decodeEmbedPayload(embedPage) {
  const blob = embedPage.match(/window\.__P="([^"]*)"/);
  if (!blob) throw new Error('Embed page changed: no __P blob');
  const bytes = Buffer.from(blob[1], 'base64')
    .map((byte, index) => byte ^ EMBED_XOR_KEY[index % EMBED_XOR_KEY.length]);
  return JSON.parse(Buffer.from(bytes).toString());
}

/**
 * Picks the stream matching a quality label, falling back to the best one
 * (same behaviour as ani-cli's `-q`).
 * @param {!Array<!import('./playlist').Stream>} streams Best first.
 * @param {string} quality e.g. '720p', or 'best'.
 * @return {!import('./playlist').Stream}
 */
function pickStream(streams, quality) {
  return streams.find((stream) => stream.label === quality) || streams[0];
}

module.exports = {
  search, getEpisodes, getStreamLinks, decodeEmbedPayload, pickStream,
};
