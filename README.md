# ani-cli GUI

A desktop app (Electron) for [ani-cli](https://github.com/pystardust/ani-cli). It's a Node port of ani-cli 5.1.5's hianime scraper, so you don't need ani-cli, bash or fzf.

## Features

- **Search**: shows posters and how many sub/dub episodes each show has.
- **Play**: opens an episode in [mpv](https://mpv.io) with subtitles. If mpv isn't installed, it uses `ffplay` instead (no subtitles).
- **Download**: uses `ffmpeg -c copy` to save `.mp4` + `.vtt` files to `Downloads\ani-cli` (📁 changes the folder). You can download one episode or the whole season. Downloads run one at a time, show progress and can be cancelled.
- **Sub/Dub** and **quality** (best, 1080p, 720p, 360p) can be picked in the header.

aria2 isn't used because the streams are HLS (`.m3u8`), and aria2 can't download HLS. ffmpeg handles HLS directly.

## Setup and build (Windows)

```bat
setup.bat
```

The script:

1. Installs Node.js LTS with winget if it's missing. After that, open a new terminal and run the script again.
2. Installs `ffmpeg` (`Gyan.FFmpeg`) and `mpv` (`shinchiro.mpv`) with winget if they're missing.
3. Runs `npm ci`.
4. Builds a portable app: `dist\ani-cli GUI <version>.exe`.

To install everything and start the app in dev mode instead of building:

```bat
setup.bat run
```

## Manual setup

You need Node.js 20+, and `ffmpeg` (plus ideally `mpv`) on PATH.

```bash
npm ci
npm start          # run in dev mode
npm test           # offline parser tests
npm run test:live  # live check: search -> episodes -> stream links
npm run build      # portable .exe in dist/
```

## Project layout

```
src/
  scraper/            Node port of ani-cli's hianime scraper (no Electron)
    hianime.js        search, getEpisodes, getStreamLinks, pickStream
    playlist.js       HLS master/media playlist parsing
    html.js           attribute + entity helpers
    http.js           fetch with user agent / referer
  main/               Electron main process
    main.js           entry: window + IPC wiring
    ipc.js            handlers exposed to the renderer
    player.js         mpv, falling back to ffplay
    downloader.js     DownloadQueue (ffmpeg -c copy, progress, cancel)
    process.js        spawn helpers
    settings.js       persisted settings (download folder)
  preload/preload.js  window.aniApi bridge
  renderer/           UI (ES modules)
    index.html, styles.css, renderer.js
    results_view.js, episodes_view.js, downloads_view.js, status_bar.js, dom.js
test/
  scraper_test.js     offline unit tests
  live_smoke_test.js  hits the real site
setup.bat             installs dependencies and builds the app
```

Code follows the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html): lowerCamelCase names, CONSTANT_CASE constants, JSDoc types, and snake_case file names.

## When something breaks

The scraper copies ani-cli's `hianime_*` functions. If search or playback stops working, the site has probably changed. Compare `src/scraper/hianime.js` with the latest [ani-cli](https://github.com/pystardust/ani-cli/blob/master/ani-cli) and run `npm run test:live`.

## License

MIT

## Disclaimer

This is a CS student's personal project, built with help from AI tools. Don't expect maintenance, updates or support. If the site changes and the app breaks, it may stay broken. You're welcome to fork it and fix it yourself.
