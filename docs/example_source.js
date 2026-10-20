/**
 * @fileoverview Example drop-in source. Copy this file into a node's sources
 * folder and restart the node (or the app) to see "Demo streams" as a source.
 *
 * It serves one public test stream (Big Buck Bunny, (c) Blender Foundation,
 * CC BY 3.0) from Mux's test server, to show the shape a source needs.
 * See docs/sources.md for the full contract.
 */

const SERIES = [
  {
    id: 'big-buck-bunny',
    title: 'Big Buck Bunny',
    info: 'Blender open movie · 1 episode',
    episodes: [
      {
        id: 'bbb-1',
        number: '1',
        title: 'Big Buck Bunny',
        url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      },
    ],
  },
];

module.exports = {
  id: 'demo',
  name: 'Demo streams',
  description: 'Example drop-in source with one public test stream.',
  downloadable: true,

  async search(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return SERIES
      .filter((series) => words.every((word) => series.title.toLowerCase().includes(word)))
      .map(({id, title, info}) => ({id, title, info}));
  },

  async getEpisodes(seriesId) {
    const series = SERIES.find((candidate) => candidate.id === seriesId);
    if (!series) throw new Error('Unknown series');
    return series.episodes.map(({id, number, title}) => ({id, number, title}));
  },

  async getStream(episodeId) {
    const episode = SERIES.flatMap((series) => series.episodes).find((e) => e.id === episodeId);
    if (!episode) throw new Error('Unknown episode');
    return {type: 'hls', url: episode.url};
  },
};
