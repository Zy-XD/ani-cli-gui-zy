/**
 * @fileoverview Offline tests for the scraper's parsers. Run: npm test
 */

const assert = require('node:assert');
const {test} = require('node:test');
const {decodeEmbedPayload, pickStream} = require('../src/sources/hianime/hianime');
const {decodeEntities, readAttribute} = require('../src/sources/hianime/html');
const {getPlaylistDuration, parseMasterPlaylist} = require('../src/sources/hianime/playlist');
const {toSafeFileName} = require('../src/main/downloader');

const MASTER_URL = 'https://cdn.example/p/abc/master.m3u8';
const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080
https://other.example/1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
720/index.m3u8
`;

test('parseMasterPlaylist sorts best first and resolves relative URIs', () => {
  assert.deepStrictEqual(parseMasterPlaylist(MASTER_PLAYLIST, MASTER_URL), [
    {label: '1080p', url: 'https://other.example/1080/index.m3u8'},
    {label: '720p', url: 'https://cdn.example/p/abc/720/index.m3u8'},
    {label: '360p', url: 'https://cdn.example/p/abc/360/index.m3u8'},
  ]);
});

test('parseMasterPlaylist falls back to the playlist itself', () => {
  assert.deepStrictEqual(parseMasterPlaylist('#EXTM3U\n#EXTINF:4,\nseg.ts', MASTER_URL),
      [{label: 'auto', url: MASTER_URL}]);
});

test('getPlaylistDuration sums segments', () => {
  assert.strictEqual(getPlaylistDuration('#EXTINF:4.5,\na.ts\n#EXTINF:5,\nb.ts\n'), 9.5);
});

test('pickStream matches the label or falls back to best', () => {
  const streams = parseMasterPlaylist(MASTER_PLAYLIST, MASTER_URL);
  assert.strictEqual(pickStream(streams, '720p').label, '720p');
  assert.strictEqual(pickStream(streams, '480p').label, '1080p');
  assert.strictEqual(pickStream(streams, 'best').label, '1080p');
});

test('decodeEmbedPayload reverses the base64 + XOR obfuscation', () => {
  const key = Buffer.from('otaku-embed-v1');
  const payload = {src: 'https://cdn.example/master.m3u8', subtitles: []};
  const bytes = Buffer.from(JSON.stringify(payload)).map((byte, i) => byte ^ key[i % key.length]);
  const page = `<script>window.__P="${Buffer.from(bytes).toString('base64')}";</script>`;
  assert.deepStrictEqual(decodeEmbedPayload(page), payload);
});

test('html helpers', () => {
  assert.strictEqual(decodeEntities(' Frieren: Beyond Journey&#039;s End &amp; &quot;x&quot; '),
      'Frieren: Beyond Journey\'s End & "x"');
  assert.strictEqual(readAttribute('<li data-id="9227" data-number="1">', 'data-number'), '1');
  assert.strictEqual(readAttribute('<li>', 'data-id'), undefined);
});

test('toSafeFileName replaces characters Windows forbids', () => {
  assert.strictEqual(toSafeFileName('Re:Zero <1/2>?'), 'Re_Zero _1_2__');
});

test('toSafeFileName never points outside the download folder', () => {
  assert.strictEqual(toSafeFileName('..'), '_');
  assert.strictEqual(toSafeFileName('.'), '_');
  assert.strictEqual(toSafeFileName(''), '_');
  assert.strictEqual(toSafeFileName('Season 2...'), 'Season 2');
  assert.strictEqual(toSafeFileName('CON'), '_CON');
  assert.strictEqual(toSafeFileName('nul.txt'), '_nul.txt');
  assert.strictEqual(toSafeFileName('a\nb'), 'a_b');
});

test('isNewer compares release tags with the app version', () => {
  const {isNewer} = require('../src/main/update_check');
  assert.strictEqual(isNewer('v0.3.0', '0.2.9'), true);
  assert.strictEqual(isNewer('v1.0.0', '0.10.0'), true);
  assert.strictEqual(isNewer('v0.2.0', '0.2.0'), false);
  assert.strictEqual(isNewer('v0.1.9', '0.2.0'), false);
  assert.strictEqual(isNewer('v0.10.0', '0.9.0'), true);
});

test('requireHttpUrl only lets http(s) URLs reach mpv and ffmpeg', () => {
  const {requireHttpUrl} = require('../src/main/process');
  assert.strictEqual(requireHttpUrl('http://127.0.0.1:1/k/api/proxy?u=x'), 'http://127.0.0.1:1/k/api/proxy?u=x');
  for (const url of ['file:///C:/secret.txt', 'C:\secret.txt', '--script=evil.lua', 'edl://x', '']) {
    assert.throws(() => requireHttpUrl(url), /http/, url);
  }
});
