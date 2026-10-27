# Sources and nodes

Sources work much like [Aniyomi](https://github.com/aniyomiorg/aniyomi) extensions: each source is one place where anime comes from.

```
 UI (desktop app, web app, any browser)
   │  HTTP
   ▼
 node ── sources ── hianime (ani-cli port)
   │             ├─ Local files (a folder on the node)
   │             └─ drop-in sources (*.js in the sources folder)
   └─ proxy: adds the Referer/user agent CDNs need, rewrites HLS playlists
```

- **Node**: a small HTTP server (`src/server`) that runs sources and serves their streams.
  - The desktop app has one built in, called "This computer".
  - `npm run serve` starts a standalone node.
  - The UI can use several nodes at once. Add them on the **Sources** page.
- **Files on this device**: a source that runs entirely in the browser and plays a folder you pick. It doesn't need a node.

## Running a node

```bash
npm run serve
```

Then either open <http://localhost:7777>, which serves the UI from the node itself, or open the hosted web app and add `http://localhost:7777` on the Sources page. Chrome may ask to allow access to devices on your local network; this is required for a site on the internet to reach a node on your computer.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `7777` | Port to listen on |
| `HOST` | `127.0.0.1` | `0.0.0.0` shares the node on your network. Anyone who can reach it can use it, and there is no login. |
| `ANI_NODE_NAME` | computer name | Name shown in the UI |
| `ANI_LOCAL_DIR` | `~/Downloads/ani-cli` | Folder for the Local files source |
| `ANI_SOURCES_DIR` | `~/.ani-cli-gui/sources` | Folder of drop-in sources |

The desktop app's node uses the download folder for Local files. Its drop-in sources folder is opened with the **Open folder** button on the Sources page (`%APPDATA%\<app name>\sources` on Windows).

## Writing a drop-in source

A source is a CommonJS file that exports an object. Put it in the sources folder and restart the node. [`example_source.js`](example_source.js) is a complete, working example.

```js
module.exports = {
  id: 'my-source',            // lowercase letters, digits, dashes; unique on the node
  name: 'My source',
  description: 'Optional one-liner shown on the Sources page',
  modes: ['sub', 'dub'],      // optional: audio choices the Sub/Dub picker passes to getStream
  downloadable: true,         // optional: show download buttons in the desktop app

  async search(query) {       // '' should list everything, if the source can
    return [{id, title, poster, info}];      // poster and info are optional
  },
  async getEpisodes(animeId) {
    return [{id, number, title}];            // number is a string ('12.5' is fine)
  },
  async getStream(episodeId, {mode, quality}) {
    return {type: 'hls', url, referer, subtitleUrl};  // HLS playlist; referer is optional
    // or {type: 'http', url, subtitleUrl}             // a plain mp4/webm on the web
    // or {type: 'file', path, subtitlePath}           // a file on the node's disk
  },
};
```

Notes:

- `id` values must stay the same between runs. The library stores them to remember saved series and watch progress.
- Subtitles must be WebVTT (`.vtt`), unless the source converts them in `transform`.
- `transform(body, url, kind)` is optional. The node's proxy passes it each HLS playlist (`kind` is `''`) and the subtitle file (`kind` is `'sub'`) of this source's streams, and serves what it returns. Use it for sites that encode their playlists or only have ASS/SRT subtitles.
- Bundled sources live in the repo's [`scrapers/`](../scrapers) folder and load on every node.
- Throw an `Error` with a readable message when something fails; the UI shows it.
- A broken file is skipped with a warning in the node's console. It doesn't stop the node.
- Drop-in sources run with full access to the computer, like any program. Only install files you trust.

## The node's HTTP API

See the header of [`src/server/server.js`](../src/server/server.js). Stream URLs are signed by the node, so its proxy only fetches what its sources returned and doesn't work as an open proxy.
