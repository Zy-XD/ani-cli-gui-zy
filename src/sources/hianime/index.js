/**
 * @fileoverview The ani-cli source: wraps the hianime scraper as a {@link Source}.
 */

const {search, getEpisodes, getStreamLinks, pickStream} = require('./hianime');

/** @type {!import('../source').Source} */
const hianimeSource = {
  id: 'hianime',
  name: 'ani-cli (hianime)',
  description: 'Streams from hianime, using the same scraper as ani-cli.',
  modes: ['sub', 'dub'],
  downloadable: true,

  async search(query) {
    return (await search(query)).map((anime) => ({
      id: anime.id,
      title: anime.title,
      poster: anime.poster,
      info: `Sub ${anime.subCount} · Dub ${anime.dubCount}`,
    }));
  },

  async getEpisodes(animeId) {
    return (await getEpisodes(animeId)).map((episode) => ({
      id: episode.episodeId,
      number: episode.number,
      title: episode.title,
    }));
  },

  async getStream(episodeId, {mode = 'sub', quality = 'best'} = {}) {
    const links = await getStreamLinks(episodeId, mode);
    return {
      type: 'hls',
      url: pickStream(links.streams, quality).url,
      referer: links.referer,
      subtitleUrl: links.subtitleUrl,
    };
  },
};

module.exports = hianimeSource;
