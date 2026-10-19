/**
 * @fileoverview DOM helpers, so the views can build elements without a framework.
 * Text is always set via `textContent`, never `innerHTML`, so titles from the
 * site can't inject markup.
 */

/**
 * Creates an element with properties and children.
 *
 *     createElement('button', {textContent: 'Play', onclick: play})
 *
 * @param {string} tagName
 * @param {!Object=} properties Assigned onto the element (e.g. className, onclick).
 * @param {...(!Node|string)} children Appended in order; strings become text nodes.
 * @return {!HTMLElement}
 */
export function createElement(tagName, properties = {}, ...children) {
  const element = Object.assign(document.createElement(tagName), properties);
  element.append(...children);
  return element;
}

/**
 * Grey placeholder text for empty lists.
 * @param {string} text
 * @return {!HTMLElement}
 */
export function createEmptyMessage(text) {
  return createElement('div', {className: 'empty-message', textContent: text});
}
