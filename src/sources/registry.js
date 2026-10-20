/**
 * @fileoverview Builds the list of sources a node offers: the built-in ones plus
 * drop-in source files from a folder (like installing an Aniyomi extension).
 */

const fs = require('fs');
const path = require('path');
const hianimeSource = require('./hianime');
const {createLocalSource} = require('./local/local_source');
const {validateSource} = require('./source');

/**
 * @param {{getLocalDir: function(): string, extensionsDir: (string|undefined)}} options
 *     - getLocalDir: folder for the "Local files" source.
 *     - extensionsDir: folder of drop-in `*.js` sources; skipped if it doesn't exist.
 * @return {!Array<!import('./source').Source>}
 */
function loadSources({getLocalDir, extensionsDir}) {
  const sources = [hianimeSource, createLocalSource(getLocalDir)];
  for (const source of loadExtensions(extensionsDir)) {
    if (sources.some((existing) => existing.id === source.id)) {
      console.warn(`Skipping source "${source.id}": the id is already taken`);
    } else {
      sources.push(source);
    }
  }
  return sources;
}

/**
 * Loads every `*.js` file in a folder as a source. A broken file is logged and
 * skipped, so one bad extension doesn't stop the node.
 * Extensions run with full Node access: only install files you trust.
 * @param {string|undefined} directory
 * @return {!Array<!import('./source').Source>}
 */
function loadExtensions(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  const sources = [];
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.js'))) {
    try {
      const source = require(path.resolve(directory, file));
      const problem = validateSource(source);
      if (problem) throw new Error(problem);
      sources.push(source);
    } catch (error) {
      console.warn(`Skipping source file ${file}: ${error.message}`);
    }
  }
  return sources;
}

module.exports = {loadSources};
