#!/usr/bin/env node
/**
 * @fileoverview Standalone node: `npm run serve`, then open http://localhost:7777
 * or add that address in the web app's Sources page.
 *
 * Environment variables:
 *   PORT              default 7777
 *   HOST              default 127.0.0.1 (this computer only). Use 0.0.0.0 to
 *                     share on your network; anyone who can reach it can use it.
 *   ANI_NODE_NAME     name shown in the UI, default the computer's name
 *   ANI_LOCAL_DIR     folder for the "Local files" source, default ~/Downloads/ani-cli
 *   ANI_SOURCES_DIR   folder of drop-in sources, default ~/.ani-cli-gui/sources
 */

const os = require('os');
const path = require('path');
const {loadSources} = require('../sources/registry');
const {createNodeServer} = require('./server');

const port = Number(process.env.PORT) || 7777;
const host = process.env.HOST || '127.0.0.1';
const localDir = process.env.ANI_LOCAL_DIR || path.join(os.homedir(), 'Downloads', 'ani-cli');
const extensionsDir = process.env.ANI_SOURCES_DIR || path.join(os.homedir(), '.ani-cli-gui', 'sources');

const sources = loadSources({getLocalDir: () => localDir, extensionsDir});
const server = createNodeServer({
  name: process.env.ANI_NODE_NAME || os.hostname(),
  sources,
  staticDir: path.join(__dirname, '../renderer'),
});
server.listen(port, host, () => {
  console.log(`Node running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`Sources: ${sources.map((source) => source.id).join(', ')}`);
  console.log(`Local files: ${localDir}`);
  console.log(`Drop-in sources: ${extensionsDir}`);
});
