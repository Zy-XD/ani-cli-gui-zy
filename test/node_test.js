/**
 * @fileoverview Offline tests for the node: file grouping, the local source,
 * playlist rewriting, signed URLs and the HTTP API. Run: npm test
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {groupIntoSeries, parseEpisodePath} = require('../src/renderer/shared/media_files.mjs');
const {createLocalSource} = require('../src/sources/local/local_source');
const {validateSource} = require('../src/sources/source');
const {rewritePlaylist} = require('../src/server/media');
const {signParams, verifyParams} = require('../src/server/signed_urls');
const {createNodeServer} = require('../src/server/server');

test('parseEpisodePath reads folders and "Episode N" names', () => {
  assert.deepStrictEqual(parseEpisodePath('Frieren/Frieren Episode 3.mp4'),
      {seriesTitle: 'Frieren', number: '3', fileTitle: 'Frieren Episode 3'});
  assert.deepStrictEqual(parseEpisodePath('Show - Ep 12.5.mkv'),
      {seriesTitle: 'Show', number: '12.5', fileTitle: 'Show - Ep 12.5'});
  assert.deepStrictEqual(parseEpisodePath('Movie.mp4'),
      {seriesTitle: 'Movie', number: null, fileTitle: 'Movie'});
});

test('groupIntoSeries sorts naturally, numbers unnamed files and skips non-videos', () => {
  const series = groupIntoSeries(['B/b10.mp4', 'B/b2.mp4', 'A Episode 1.mp4', 'A Episode 1.vtt', 'notes.txt']);
  assert.deepStrictEqual(series.map((s) => s.title), ['A', 'B']);
  assert.deepStrictEqual(series[1].episodes.map((e) => [e.id, e.number]), [['B/b2.mp4', '1'], ['B/b10.mp4', '2']]);
});

test('local source lists series and refuses paths outside its folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ani-local-'));
  fs.mkdirSync(path.join(root, 'Show'));
  fs.writeFileSync(path.join(root, 'Show', 'Show Episode 1.mp4'), 'x');
  fs.writeFileSync(path.join(root, 'Show', 'Show Episode 1.vtt'), 'WEBVTT');
  const source = createLocalSource(() => root);
  assert.strictEqual(validateSource(source), null);

  assert.deepStrictEqual((await source.search('sho')).map((s) => s.id), ['Show']);
  const [episode] = await source.getEpisodes('Show');
  const stream = await source.getStream(episode.id);
  assert.strictEqual(stream.type, 'file');
  assert.ok(stream.subtitlePath.endsWith('Show Episode 1.vtt'));
  await assert.rejects(source.getStream('../outside.mp4'), /outside the folder/);
  fs.rmSync(root, {recursive: true});
});

test('rewritePlaylist proxies segment lines and URI attributes', () => {
  const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg1.ts\n';
  const rewritten = rewritePlaylist(playlist, 'https://cdn.example/a/index.m3u8', 'https://ref.example/');
  const lines = rewritten.split('\n');
  assert.match(lines[1], /^#EXT-X-KEY:METHOD=AES-128,URI="proxy\?u=https%3A%2F%2Fcdn\.example%2Fa%2Fkey\.bin&r=/);
  assert.match(lines[3], /^proxy\?u=https%3A%2F%2Fcdn\.example%2Fa%2Fseg1\.ts&r=https%3A%2F%2Fref\.example%2F&s=/);
  assert.strictEqual(lines[2], '#EXTINF:4,');
});

test('signed params verify, and tampering is rejected', () => {
  const query = new URLSearchParams(signParams({u: 'https://a.example/x', r: ''}));
  assert.deepStrictEqual(verifyParams(query, ['u', 'r']), {u: 'https://a.example/x', r: ''});
  query.set('u', 'https://evil.example/');
  assert.strictEqual(verifyParams(query, ['u', 'r']), null);
});

test('node API serves info, search, stream and files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ani-node-'));
  fs.writeFileSync(path.join(root, 'Clip Episode 1.mp4'), '0123456789');
  const key = 'test-key-0123456789';
  const server = createNodeServer({name: 'Test', sources: [createLocalSource(() => root)], key});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = `${origin}/${key}/api/`;
  try {
    // Without the key (e.g. another website probing localhost), nothing is served.
    assert.strictEqual((await fetch(`${origin}/api/sources/local/search?q=`)).status, 404);
    assert.strictEqual((await fetch(`${origin}/wrong-key-0123456789/api/info`)).status, 404);

    const info = await (await fetch(`${api}info`)).json();
    assert.strictEqual(info.name, 'Test');
    assert.deepStrictEqual(info.sources.map((s) => s.id), ['local']);

    const [series] = await (await fetch(`${api}sources/local/search?q=`)).json();
    const [episode] = await (await fetch(`${api}sources/local/episodes?animeId=${series.id}`)).json();
    const stream = await (await fetch(`${api}sources/local/stream?episodeId=${encodeURIComponent(episode.id)}`)).json();
    assert.strictEqual(stream.type, 'file');

    const ranged = await fetch(new URL(stream.url, api), {headers: {Range: 'bytes=2-4'}});
    assert.strictEqual(ranged.status, 206);
    assert.strictEqual(await ranged.text(), '234');
    assert.strictEqual(ranged.headers.get('access-control-allow-origin'), '*');

    assert.strictEqual((await fetch(`${api}proxy?u=https://example.com&r=&s=x`)).status, 403);
    assert.strictEqual((await fetch(`${api}sources/nope/search?q=a`)).status, 404);
  } finally {
    server.close();
    fs.rmSync(root, {recursive: true});
  }
});

test('the example drop-in source loads through the registry', async () => {
  const {loadSources} = require('../src/sources/registry');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ani-ext-'));
  fs.copyFileSync(path.join(__dirname, '..', 'docs', 'example_source.js'), path.join(dir, 'demo.js'));
  fs.writeFileSync(path.join(dir, 'broken.js'), 'module.exports = {id: "Bad Id"};');
  const sources = loadSources({getLocalDir: () => dir, extensionsDir: dir});
  // Bundled scrapers (scrapers/) load between the built-ins and the folder's files.
  const ids = sources.map((source) => source.id);
  assert.deepStrictEqual([...ids.slice(0, 2), ids.at(-1)], ['hianime', 'local', 'demo']);
  assert.ok(!ids.includes('Bad Id'));
  const demo = sources.at(-1);
  const [series] = await demo.search('bunny');
  const [episode] = await demo.getEpisodes(series.id);
  assert.strictEqual((await demo.getStream(episode.id)).type, 'hls');
  fs.rmSync(dir, {recursive: true});
});
