/**
 * @fileoverview Tiny regex-based HTML helpers.
 * The scraper reads a few known attributes from server HTML, so a full HTML
 * parser isn't needed (ani-cli does the same with sed).
 */

/**
 * Decodes the few HTML entities the site uses in titles and trims whitespace.
 * @param {string} text e.g. 'Journey&#039;s End'.
 * @return {string} e.g. "Journey's End".
 */
function decodeEntities(text) {
  return text
    .replace(/&#0?39;/g, '\'')
    .replace(/&quot;/g, '"')
    // Decoded last so '&amp;quot;' becomes '&quot;', not '"'.
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Reads the first `name="value"` attribute found in an HTML fragment.
 * @param {string} html
 * @param {string} name Attribute name, e.g. 'data-id'. Used inside a regex,
 *     so pass plain names only.
 * @return {string|undefined} The raw (still entity-encoded) value, or undefined.
 */
function readAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : undefined;
}

module.exports = {decodeEntities, readAttribute};
