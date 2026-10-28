#!/usr/bin/env node
/**
 * @fileoverview Standalone node: `npm run serve`, then open the address it
 * prints (http://localhost:7777/<key>/) or add it in the web app's Sources page.
 *
 * Environment variables:
 *   PORT              default 7777
 *   HOST              default 127.0.0.1 (this computer only). Use 0.0.0.0 to
 *                     share on your network; only people given the key can use it.
 *   ANI_NODE_NAME     name shown in the UI, default the computer's name
 *   ANI_NODE_KEY      secret in the node's address, default a random one kept in
 *                     ~/.ani-cli-gui/node-key so saved addresses keep working
 *   ANI_LOCAL_DIR     folder for the "Local files" source, default ~/Downloads/ani-cli
 *   ANI_SOURCES_DIR   folder of drop-in sources, default ~/.ani-cli-gui/sources
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {loadSources} = require('../sources/registry');
const {createNodeServer} = require('./server');

const port = Number(process.env.PORT) || 7777;
const host = process.env.HOST || '127.0.0.1';
const configDir = path.join(os.homedir(), '.ani-cli-gui');
const localDir = process.env.ANI_LOCAL_DIR || path.join(os.homedir(), 'Downloads', 'ani-cli');
const extensionsDir = process.env.ANI_SOURCES_DIR || path.join(configDir, 'sources');

/** @return {string} ANI_NODE_KEY, else the saved key, else a new saved one. */
function loadKey() {
  if (process.env.ANI_NODE_KEY) return process.env.ANI_NODE_KEY;
  const keyFile = path.join(configDir, 'node-key');
  try {
    return fs.readFileSync(keyFile, 'utf8').trim();
  } catch {
    const key = crypto.randomBytes(24).toString('base64url');
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(keyFile, key, {mode: 0o600});
    return key;
  }
}

const key = loadKey();
const sources = loadSources({getLocalDir: () => localDir, extensionsDir});
const server = createNodeServer({
  name: process.env.ANI_NODE_NAME || os.hostname(),
  sources,
  staticDir: path.join(__dirname, '../renderer'),
  key,
});
server.listen(port, host, () => {
  console.log(`Node running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/${key}/`);
  console.log('The address includes a secret key: share it only with people who may use this node.');
  console.log(`Sources: ${sources.map((source) => source.id).join(', ')}`);
  console.log(`Local files: ${localDir}`);
  console.log(`Drop-in sources: ${extensionsDir}`);
});
