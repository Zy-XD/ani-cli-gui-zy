/**
 * @fileoverview Signs the URLs a node hands out for /api/proxy and /api/file.
 *
 * Without signing, /api/proxy would be an open proxy (fetch anything with any
 * Referer) and /api/file would read any file on disk. A node only serves URLs
 * it signed itself, so it only proxies or reads what a source returned.
 * The key is random per process, so links stop working after a restart; the
 * client asks for a fresh stream each time it plays.
 */

const crypto = require('crypto');

const KEY = crypto.randomBytes(32);

/**
 * @param {!Array<string>} values
 * @return {string} URL-safe signature.
 */
function sign(values) {
  return crypto.createHmac('sha256', KEY).update(JSON.stringify(values)).digest('base64url');
}

/**
 * Builds a signed query string.
 * @param {!Object<string, string>} params
 * @return {string} e.g. 'u=...&r=...&s=...' (no leading '?').
 */
function signParams(params) {
  const keys = Object.keys(params).sort();
  const query = new URLSearchParams(params);
  query.set('s', sign(keys.map((key) => `${key}=${params[key]}`)));
  return query.toString();
}

/**
 * Checks a signed query string and returns its parameters.
 * @param {!URLSearchParams} query
 * @param {!Array<string>} keys The parameters that were signed.
 * @return {?Object<string, string>} Null if the signature doesn't match.
 */
function verifyParams(query, keys) {
  const params = Object.fromEntries(keys.map((key) => [key, query.get(key) || '']));
  const expected = Buffer.from(sign([...keys].sort().map((key) => `${key}=${params[key]}`)));
  const actual = Buffer.from(query.get('s') || '');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ?
    params : null;
}

module.exports = {signParams, verifyParams};
