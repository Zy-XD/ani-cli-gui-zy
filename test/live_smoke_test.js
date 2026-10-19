/**
 * @fileoverview Hits the real site: search -> episodes -> stream links.
 * Run: npm run test:live [-- "query"]
 */

const assert = require('node:assert');
const {test} = require('node:test');
const {search, getEpisodes, getStreamLinks} = require('../src/scraper/hianime');

const QUERY = process.argv.slice(2).find((arg) => !arg.startsWith('-')) || 'frieren';

test(`live scrape for "${QUERY}"`, async () => {
  const results = await search(QUERY);
  assert.ok(results.length && results[0].id && results[0].title, 'search returned nothing');

  const episodes = await getEpisodes(results[0].id);
  assert.ok(episodes.length && episodes[0].episodeId, 'no episodes');

  const links = await getStreamLinks(episodes[0].episodeId);
  assert.ok(links.referer, 'no referer');
  assert.match(links.streams[0].url, /^https?:\/\//);
  console.log(results[0].title, '| episode', episodes[0].number, '|',
      links.streams.map((stream) => stream.label).join(', '));
});
