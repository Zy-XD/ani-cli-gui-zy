/**
 * @fileoverview Re:ANIME (reanime.wtf) drop-in source.
 *
 * Flow: search and episode lists come from the site's SvelteKit `__data.json`
 * endpoints. `/api/flix/<anilist>/<episode>` lists flixcloud embeds; the embed
 * hides its HLS URL behind AES-CBC, decrypted here the same way its player does
 * (see decryptEmbed). See docs/sources.md for the source contract.
 */

const crypto = require('crypto');

const SITE = 'https://reanime.wtf';
const EMBED = 'https://flixcloud.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function get(url, referer) {
  const response = await fetch(url, {headers: {'User-Agent': UA, ...(referer && {Referer: referer})}});
  if (!response.ok) throw new Error(`Re:ANIME: ${response.status} from ${new URL(url).pathname}`);
  return response;
}

/**
 * Decodes SvelteKit's devalue format: a flat array where objects and arrays
 * hold indexes into it. Negative indexes are undefined/null/NaN; treated as null.
 * @param {!Array} values
 * @return {*}
 */
function devalue(values) {
  const seen = new Map();
  const hydrate = (index) => {
    if (index < 0) return null;
    if (seen.has(index)) return seen.get(index);
    const value = values[index];
    if (value === null || typeof value !== 'object') return value;
    // ['Date', '...'] and similar tagged values: keep as-is.
    if (Array.isArray(value) && typeof value[0] === 'string') return value;
    const out = Array.isArray(value) ? [] : {};
    seen.set(index, out);
    for (const key of Object.keys(value)) out[key] = hydrate(value[key]);
    return out;
  };
  return hydrate(0);
}

/** Loads a page's `__data.json` and returns the node whose data has `key`. */
async function pageData(path, key, query = '') {
  const json = await (await get(`${SITE}${path}/__data.json${query}`)).json();
  for (const node of json.nodes || []) {
    if (node?.type !== 'data') continue;
    const data = devalue(node.data);
    if (data && key in data) return data;
  }
  throw new Error(`Re:ANIME: ${path} has no ${key}`);
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const b64 = (text) => Buffer.from(text, 'base64');

/** Reads a string field from the embed's inline JS object (no eval). */
function field(html, name) {
  const match = html.match(new RegExp(`["']?${name}["']?\\s*:\\s*"([^"]*)"`));
  return match ? match[1] : null;
}

/** Runs the embed's WASM. It has no imports, so it can only compute. */
async function loadWasm(html) {
  const {instance} = await WebAssembly.instantiate(b64(field(html, 'w_payload')), {});
  const {memory} = instance.exports;
  if (memory.buffer.byteLength === 0) memory.grow(1);
  return instance.exports;
}

/**
 * Mirrors the flixcloud player's nr(): field names are derived from the seed,
 * a token fetched from /api/m3u8 holds the ciphertext and a key fragment, the
 * page's WASM mixes the key fragments, then PBKDF2 + SHA-256 give the AES key.
 * @param {string} html embed page
 * @return {!Promise<{url: string, playlistKey: string}>} the HLS URL, and the
 *     base64 XOR key its playlists are encoded with (the player's window.__pk).
 */
async function decryptEmbed(html) {
  const seed = field(html, 'obfuscation_seed');
  if (!seed || !field(html, 'w_payload')) throw new Error('Re:ANIME: embed has no stream data');

  let e = seed;
  for (let i = 0; i < 3; i++) e = sha256(e + i);
  let a = e;
  for (let i = 0; i < 3; i++) a = sha256(a + i);
  const frag1 = field(html, `kf_${e.slice(8, 16)}`);
  const iv = field(html, `ivf_${e.slice(16, 24)}`);
  const frag2 = field(html, `${a.slice(0, 16)}_${a.slice(16, 24)}`);
  const token = field(html, `${e.slice(48, 64)}_${e.slice(56, 64)}`);
  if (!frag1 || !iv || !frag2 || !token) throw new Error('Re:ANIME: embed format changed');

  const tokenData = await (await get(`${EMBED}/api/m3u8/${token}`, `${EMBED}/`)).json();
  const cipher = tokenData[sha256(token + 'vid').slice(0, 10)];
  const frag3 = tokenData[sha256(token + 'key').slice(0, 10)];
  if (!cipher || !frag3) throw new Error('Re:ANIME: incomplete token response');

  const {memory, _s, _r, _c} = await loadWasm(html);
  const parts = [b64(frag1), b64(frag2), b64(frag3)];
  const length = parts[0].length;
  const heap = new Uint8Array(memory.buffer);
  parts.forEach((part, i) => heap.set(part, 1000 + i * length));
  _s(parseInt(seed.slice(0, 8), 16));
  _r(1000, 1000 + length, 1000 + 2 * length, 1000 + 3 * length, length);
  const mixed = Buffer.from(new Uint8Array(memory.buffer).slice(1000 + 3 * length, 1000 + 4 * length));

  const bits = crypto.pbkdf2Sync(mixed, Buffer.from(seed), 1000, 32, 'sha256');
  for (let i = 0; i < 32; i++) bits[i] ^= seed.charCodeAt(i % seed.length);
  const key = crypto.createHash('sha256').update(bits).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, b64(iv));
  const url = Buffer.concat([decipher.update(b64(cipher)), decipher.final()]).toString().trim();
  if (!url) throw new Error('Re:ANIME: decryption gave an empty URL');
  const pk = _c();
  return {url, playlistKey: Buffer.from(new Uint8Array(memory.buffer).slice(pk, pk + 32)).toString('base64')};
}

/**
 * Picks the full English subtitle track for sub. Dub gets none: its only
 * track is signs and songs, which is all typesetting and flattens to noise.
 */
function pickSubtitle(html, mode) {
  if (mode === 'dub') return undefined;
  return [...html.matchAll(/\{url:"([^"]+)",language:"([^"]*)",format:"([^"]*)"/g)]
      .map(([, url, language, format]) => ({url, language, format}))
      .find((track) => /^(ass|ssa|srt|vtt)$/.test(track.format) && /^English/i.test(track.language) &&
        !/signs|songs|AI\)/i.test(track.language));
}

/**
 * Fansub style names for typesetting and karaoke, which only make sense
 * positioned on screen. ponytail: name heuristic, extend if a release uses other names.
 */
const NON_DIALOGUE_STYLE = /sign|song|kara|typeset|title|note|^(op|ed)\b|^(op|ed)[-_ ]/i;

/** `0:01:02.34` (ASS) or `00:01:02,340` (SRT) -> `00:01:02.340`. */
function vttTime(time) {
  const [h, m, s] = time.trim().replace(',', '.').split(':');
  const [secs, frac = '0'] = s.split('.');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${secs.padStart(2, '0')}.${frac.padEnd(3, '0').slice(0, 3)}`;
}

/**
 * ASS/SRT -> WebVTT. Keeps timing and text; drops styling and positioning.
 * ponytail: plain cues only, typesetting (signs placed on screen) is lost; render with libass if it matters.
 */
function toVtt(text) {
  if (text.startsWith('WEBVTT')) return text;
  const cues = [];
  if (/^\[Script Info\]/m.test(text)) {
    let format = null;
    for (const line of text.split(/\r?\n/)) {
      // [V4+ Styles] has a Format line too; only the [Events] one has Start.
      if (line.startsWith('Format:') && /\bStart\b/.test(line)) {
        format = line.slice(7).split(',').map((s) => s.trim());
      } else if (line.startsWith('Dialogue:') && format) {
        const values = line.slice(9).split(',');
        const cell = (name) => values[format.indexOf(name)];
        if (NON_DIALOGUE_STYLE.test(cell('Style').trim())) continue;
        const body = values.slice(format.length - 1).join(',')
            .replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim();
        if (body) cues.push({start: cell('Start'), end: cell('End'), body});
      }
    }
  } else {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const match = block.match(/([\d:,.]+)\s*-->\s*([\d:,.]+)[^\n]*\n([\s\S]*)/);
      if (match) cues.push({start: match[1], end: match[2], body: match[3].replace(/<[^>]+>/g, '').trim()});
    }
  }
  const lines = cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.body}`);
  // Layered lines (outline + fill) repeat the same cue; keep one.
  return 'WEBVTT\n\n' + [...new Set(lines)].sort().join('\n\n') + '\n';
}

/**
 * Undoes the base64 + XOR the flixcloud CDN puts on playlists. The key and the
 * mode ride along in the URL's #fragment (k=<base64 key>&dub), copied onto
 * child playlist URIs so each one can be decoded too.
 */
function decodePlaylist(body, url) {
  const fragment = new URLSearchParams(new URL(url).hash.slice(1));
  const key = fragment.get('k') ? b64(fragment.get('k')) : null;
  let text = body.trim();
  if (!text.startsWith('#EXTM3U') && key) {
    text = Buffer.from(b64(text).map((byte, i) => byte ^ key[i % key.length])).toString();
  }
  const hash = new URL(url).hash;
  text = text.replace(/URI="([^"#]+\.m3u8[^"#]*)"/g, `URI="$1${hash}"`)
      .replace(/^([^#\s][^\s#]*\.m3u8[^\s#]*)$/gm, `$1${hash}`);
  if (fragment.has('dub')) {
    // Same stream for sub and dub: make the English audio track the default.
    text = text.replace(/^#EXT-X-MEDIA:TYPE=AUDIO.*$/gm, (line) =>
      line.replace(/DEFAULT=(YES|NO)/, `DEFAULT=${/LANGUAGE="en/.test(line) ? 'YES' : 'NO'}`));
  }
  return text;
}

module.exports = {
  id: 'reanime',
  name: 'Re:ANIME',
  description: 'Streams from reanime.wtf (flixcloud).',
  modes: ['sub', 'dub'],
  downloadable: true,

  async search(query) {
    const data = await pageData('/search', 'initial', `?q=${encodeURIComponent(query)}`);
    return (data.initial?.results || []).map((anime) => ({
      id: anime.anime_id,
      title: anime.title.english || anime.title.romaji,
      poster: anime.cover_image?.large,
      info: [anime.format, `Sub ${anime.subbed || 0}`, `Dub ${anime.dubbed || 0}`].filter(Boolean).join(' · '),
    }));
  },

  async getEpisodes(animeId) {
    const data = await pageData(`/watch/${encodeURIComponent(animeId)}`, 'episodes');
    const {anilist_id: anilist, mal_id: mal} = data.anime;
    return (data.episodes || [])
        .filter((episode) => episode.playable !== false)
        .map((episode) => ({
          id: `${anilist || 0}:${mal || 0}:${episode.episode_number}`,
          number: String(episode.episode_number),
          title: episode.title || `Episode ${episode.episode_number}`,
        }));
  },

  async getStream(episodeId, {mode = 'sub'} = {}) {
    const [anilist, mal, number] = episodeId.split(':');
    const query = mal !== '0' ? `?mal=${mal}` : '';
    const {servers = []} = await (await get(`${SITE}/api/flix/${anilist}/${number}${query}`, `${SITE}/`)).json();
    const candidates = servers.filter((server) => server.dataType === mode);
    if (!candidates.length) throw new Error(`Re:ANIME: no ${mode} servers for this episode`);
    let lastError;
    for (const server of candidates) {
      try {
        const html = await (await get(server.dataLink, `${SITE}/`)).text();
        const {url, playlistKey} = await decryptEmbed(html);
        const fragment = new URLSearchParams({k: playlistKey});
        if (mode === 'dub') fragment.set('dub', '');
        return {
          type: 'hls',
          url: `${url}#${fragment}`,
          referer: `${EMBED}/`,
          subtitleUrl: pickSubtitle(html, mode)?.url,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  },

  transform(body, url, kind) {
    return kind === 'sub' ? toVtt(body) : decodePlaylist(body, url);
  },
};

// Offline self-check: node scrapers/reanime.js
if (require.main === module) {
  const assert = require('assert');
  const key = Buffer.from('k3y');
  const plain = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="jpn",DEFAULT=YES,URI="a/jp.m3u8"\n' +
    '#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="eng",DEFAULT=NO,URI="a/en.m3u8"\nv/video.m3u8';
  const encoded = Buffer.from(Buffer.from(plain).map((byte, i) => byte ^ key[i % 3])).toString('base64');
  const hash = `#k=${key.toString('base64')}&dub=`;
  const out = decodePlaylist(encoded, `https://cdn.example/master.m3u8${hash}`);
  assert.match(out, /LANGUAGE="jpn",DEFAULT=NO/);
  assert.match(out, /LANGUAGE="eng",DEFAULT=YES/);
  assert.ok(out.includes(`URI="a/en.m3u8${hash}"`) && out.endsWith(`v/video.m3u8${hash}`));
  const ass = '[Script Info]\n[V4+ Styles]\nFormat: Name, Fontname\n[Events]\n' +
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hi,\\Nthere\n' +
    'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hi,\\Nthere\n' +
    'Dialogue: 0,0:00:02.00,0:00:04.00,Signs,,0,0,0,,{\\pos(1,1)}SHOP\n' +
    'Dialogue: 0,0:00:05.00,0:00:06.00,OP-E,,0,0,0,,{\\k20}la';
  assert.strictEqual(toVtt(ass), 'WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHi,\nthere\n');
  console.log('reanime self-check ok');
}
