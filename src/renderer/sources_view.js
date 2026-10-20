/**
 * @fileoverview Sources page: nodes and their sources, adding/removing nodes,
 * picking a local folder, and (desktop) the drop-in sources folder.
 */

import {createElement} from './dom.js';

const sourcesElement = document.getElementById('sources');

/**
 * Redraws the page.
 * @param {{
 *   nodes: !Array<!Object>,
 *   pickedFileCount: ?number,
 *   isDesktop: boolean,
 *   onAddNode: function(string),
 *   onRemoveNode: function(string),
 *   onPickFolder: function(!FileList),
 *   onOpenSourcesDir: function(),
 *   onRefresh: function(),
 * }} options
 *   - nodes: NodeState objects from source_manager.js.
 *   - pickedFileCount: videos in the picked browser folder, or null if none picked.
 */
export function renderSourcesPage(options) {
  const {nodes, pickedFileCount, isDesktop} = options;
  const addInput = createElement('input', {placeholder: 'http://localhost:7777', type: 'url', required: true});
  const addForm = createElement('form', {className: 'toolbar'},
      addInput, createElement('button', {className: 'primary-button', textContent: 'Add node'}));
  addForm.onsubmit = (event) => {
    event.preventDefault();
    options.onAddNode(addInput.value.trim());
  };

  const folderInput = createElement('input', {type: 'file', multiple: true, hidden: true});
  folderInput.webkitdirectory = true; // Lets the user pick a whole folder.
  folderInput.onchange = () => folderInput.files.length && options.onPickFolder(folderInput.files);

  sourcesElement.replaceChildren(
      createElement('div', {className: 'panel'},
          createElement('h4', {textContent: 'Nodes'},
              createElement('button', {textContent: '⟳ Refresh', onclick: options.onRefresh})),
          createElement('p', {
            textContent: 'A node is a small server that runs sources. The desktop app has one built in, ' +
              'and "npm run serve" starts one. Add a node\'s address to use its sources here.',
          }),
          addForm),
      ...nodes.map((node) => renderNode(node, options.onRemoveNode)),
      createElement('div', {className: 'panel'},
          createElement('h4', {textContent: 'Files on this device'},
              createElement('button', {textContent: 'Choose folder…', onclick: () => folderInput.click()})),
          createElement('p', {
            textContent: pickedFileCount === null ?
              'Play videos from a folder on this device, without a node.' :
              `${pickedFileCount} videos picked. Pick the folder again after reloading the page.`,
          }),
          folderInput),
      isDesktop ? createElement('div', {className: 'panel'},
          createElement('h4', {textContent: 'Drop-in sources'},
              createElement('button', {textContent: 'Open folder', onclick: options.onOpenSourcesDir})),
          createElement('p', {
            textContent: 'Put source files (.js) in this folder and restart the app to add sources. ' +
              'They run with full access to your computer, so only add files you trust. ' +
              'See docs/sources.md.',
          })) : '');
}

/**
 * @param {!Object} node NodeState.
 * @param {function(string)} onRemove
 * @return {!HTMLElement}
 */
function renderNode(node, onRemove) {
  const removeButton = node.removable ?
    createElement('button', {textContent: 'Remove', onclick: () => onRemove(node.url)}) : '';
  return createElement('div', {className: 'panel'},
      createElement('h4', {textContent: node.name || node.url}, removeButton),
      createElement('p', {textContent: node.id === 'app' ? 'Built into this app' : node.url}),
      node.error ?
        createElement('p', {className: 'error', textContent: node.error}) :
        createElement('ul', {}, ...node.sources.map((source) =>
          createElement('li', {},
              createElement('b', {textContent: source.name}),
              source.description ? ` · ${source.description}` : ''))));
}
