# ani-cli GUI

An unofficial desktop and web app for [ani-cli](https://github.com/pystardust/ani-cli). It includes a Node port of ani-cli 5.1.5's hianime scraper, so you don't need ani-cli, bash or fzf.

## Features

- **Sources**, like Aniyomi extensions: hianime (the ani-cli port), local folders, files picked in the browser, and drop-in `.js` sources. Sources run in **nodes**: small servers that can be on this computer or another one. See [docs/sources.md](docs/sources.md).
- **Library**: ☆ Save a series to the Library page. Watch progress (the episode and the timestamp) is saved as you watch, and **▶ Continue** resumes where you left off, or starts the next episode.
- **Built-in player**: plays HLS streams with hls.js and shows subtitles. It works in the desktop app and in the browser.
- **mpv** (desktop): plays in [mpv](https://mpv.io) with subtitles. Progress is read through mpv's IPC pipe. If mpv isn't installed, the app falls back to `ffplay`, which shows no subtitles and doesn't track progress.
- **Downloads** (desktop): `ffmpeg -c copy` saves `.mp4` + `.vtt` files to `Downloads\ani-cli\<series>\` (📁 changes the folder). You can download one episode or a whole season. Downloads run one at a time, show progress and can be cancelled. Downloaded files then show up in the **Local files** source, so you can watch them offline.
- **Sub/Dub** and **quality** (best, 1080p, 720p, 360p) can be picked in the header.

aria2 isn't used because the streams are HLS (`.m3u8`), and aria2 can't download HLS. ffmpeg handles HLS directly.

## Web app

GitHub Pages can only host static files. hianime needs a server, because browsers can't send the Referer header its CDN requires. So the hosted web app is the UI only, and it talks to a node you run:

```bash
npm run serve
```

This starts a node on http://localhost:7777. Then either:

- open <http://localhost:7777>, which serves the UI from the node itself, or
- open the GitHub Pages site and add `http://localhost:7777` on the **Sources** page.

Without a node, the web app can still play videos from a folder on your device (**Files on this device**). Your library is stored in each browser's local storage, so it isn't shared between the app and browsers.

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

You need Node.js 22.12+, and `ffmpeg` (plus ideally `mpv`) on PATH.

```bash
npm ci             # also copies hls.js into src/renderer/vendor
npm start          # desktop app in dev mode
npm run serve      # standalone node + web UI on http://localhost:7777
npm test           # offline tests
npm run test:live  # live check against hianime
npm run build      # portable .exe in dist/
npm run build:web  # static web app in dist-web/
```

## CI/CD

- [`ci.yml`](.github/workflows/ci.yml) runs the tests on every push and pull request. Pushes to `main` also deploy the web app to GitHub Pages. One-time setup: in the repo, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
- [`release.yml`](.github/workflows/release.yml) builds the Windows app when you push a version tag and attaches it to a GitHub Release:

  ```bash
  git tag v0.2.0
  git push origin v0.2.0
  ```

## Project layout

```
src/
  sources/              Where anime comes from (runs inside a node)
    source.js           the Source contract + validation
    registry.js         built-in sources + drop-in loader
    hianime/            ani-cli port: scraper, HLS parsing
    local/              "Local files" source (a folder on the node)
  server/               The node: HTTP API, signed stream proxy, file serving
    server.js, media.js, signed_urls.js, cli.js (npm run serve)
  main/                 Electron main process
    main.js             starts the embedded node and the window
    ipc.js              desktop-only features for the UI
    player.js           mpv (with progress over IPC), ffplay fallback
    downloader.js       DownloadQueue (ffmpeg -c copy, progress, cancel)
    process.js, settings.js
  preload/preload.js    window.aniApi bridge (desktop only)
  renderer/             UI shared by the app and the web (ES modules, no bundler)
    renderer.js         state + wiring
    sources/            node client, browser files source, node list
    library.js          saved series + watch progress (localStorage)
    *_view.js           browse, library, sources, episodes, player, downloads
    shared/             code shared with the node (file grouping)
docs/                   sources guide + example drop-in source
scripts/                vendor copy + web build
test/                   offline tests; test/live hits the real site
.github/workflows/      CI, Pages deploy, releases
setup.bat               installs dependencies and builds the app
```

Code follows the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html): lowerCamelCase names, CONSTANT_CASE constants, JSDoc types, and snake_case file names.

## When something breaks

The scraper copies ani-cli's `hianime_*` functions. If search or playback stops working, the site has probably changed. Compare `src/sources/hianime/hianime.js` with the latest [ani-cli](https://github.com/pystardust/ani-cli/blob/master/ani-cli) and run `npm run test:live`.

## License

[GPL-3.0](LICENSE). The scraper in `src/sources/hianime/` is a port of [ani-cli](https://github.com/pystardust/ani-cli), which is GPL-3.0, so this project uses the same license. The web app loads [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0).

## Disclaimer

This project is not affiliated with or endorsed by ani-cli, hianime or any streaming site. It doesn't host, store or distribute any content. Like a web browser, it only requests what third-party sites already make public. The developer doesn't control that content and isn't responsible for how it's used. Check whether streaming or downloading it is legal where you live, and use this app at your own risk. If you hold rights to content these sites serve, contact the site that hosts it.

This is a CS student's personal project, built with help from AI tools. Don't expect maintenance, updates or support. If the site changes and the app breaks, it may stay broken. You're welcome to fork it and fix it yourself.
