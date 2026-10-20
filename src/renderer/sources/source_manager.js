/**
 * @fileoverview Keeps track of nodes and the sources they offer.
 *
 * Nodes come from three places:
 * - the desktop app's own node (window.aniApi.getEmbeddedNode), id 'app';
 * - the node serving this page, when the UI is opened from one (`npm run serve`), id 'origin';
 * - nodes the user added on the Sources page, saved in localStorage, id = their URL.
 * Plus the browser's own "Files on this device" source.
 */

import {readJson, writeJson} from '../storage.js';
import {browserFilesSource} from './browser_files_source.js';
import {connectToNode} from './node_client.js';

const NODES_KEY = 'nodes';

/**
 * @typedef {{
 *   id: string,
 *   url: string,
 *   removable: boolean,
 *   name: (string|undefined),
 *   error: (string|undefined),
 *   sources: !Array<!import('./node_client.js').ClientSource>,
 * }}
 * - name / error: set by refresh(), from the node or from the failed connection.
 */
let NodeState;

/** @type {!Array<!NodeState>} */
let nodes = [];

/** @type {!Array<{id: string, url: string, removable: boolean}>} Nodes that aren't user-added. */
let builtInNodes = [];

/**
 * Finds the built-in nodes. Call once at startup.
 * @return {!Promise<void>}
 */
export async function initSources() {
  builtInNodes = [];
  if (window.aniApi) {
    builtInNodes.push({id: 'app', url: await window.aniApi.getEmbeddedNode(), removable: false});
  } else if (location.protocol.startsWith('http')) {
    // Opened from a node? It answers api/info next to the page.
    const pageDir = new URL('.', location.href).href;
    const response = await fetch(new URL('api/info', pageDir)).catch(() => null);
    const isNode = response && response.ok &&
      (response.headers.get('content-type') || '').includes('json');
    if (isNode) builtInNodes.push({id: 'origin', url: pageDir, removable: false});
  }
  await refreshSources();
}

/**
 * Reconnects to every node. A node that fails keeps its error, so the Sources
 * page can show it, and contributes no sources.
 * @return {!Promise<void>}
 */
export async function refreshSources() {
  const saved = readJson(NODES_KEY, []).map((url) => ({id: url, url, removable: true}));
  nodes = await Promise.all([...builtInNodes, ...saved].map(async (node) => {
    try {
      return {...node, ...(await connectToNode(node))};
    } catch (error) {
      return {...node, error: error.message, sources: []};
    }
  }));
}

/** @return {!Array<!NodeState>} */
export function getNodes() {
  return nodes;
}

/** @return {!Array<!import('./node_client.js').ClientSource>} Every available source. */
export function getSources() {
  return [...nodes.flatMap((node) => node.sources), browserFilesSource];
}

/**
 * @param {string} key
 * @return {?import('./node_client.js').ClientSource} Null if its node is gone or offline.
 */
export function findSource(key) {
  return getSources().find((source) => source.key === key) || null;
}

/**
 * Saves a node address and connects to it.
 * @param {string} url
 * @return {!Promise<void>}
 * @throws {Error} If the URL isn't http(s).
 */
export async function addNode(url) {
  const normalized = new URL(url).href;
  if (!/^https?:$/.test(new URL(normalized).protocol)) throw new Error('Use an http:// or https:// address');
  const saved = readJson(NODES_KEY, []);
  if (!saved.includes(normalized)) writeJson(NODES_KEY, [...saved, normalized]);
  await refreshSources();
}

/**
 * @param {string} url As saved (NodeState.url).
 * @return {!Promise<void>}
 */
export async function removeNode(url) {
  writeJson(NODES_KEY, readJson(NODES_KEY, []).filter((saved) => saved !== url));
  await refreshSources();
}
