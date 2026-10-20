/**
 * @fileoverview Copies browser libraries from node_modules into src/renderer/vendor,
 * so the UI can load them in Electron (file://), from a node, and on GitHub Pages
 * without a bundler. Runs automatically after `npm install` (postinstall).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendorDir = path.join(root, 'src', 'renderer', 'vendor');

fs.mkdirSync(vendorDir, {recursive: true});
fs.copyFileSync(
    path.join(root, 'node_modules', 'hls.js', 'dist', 'hls.min.js'),
    path.join(vendorDir, 'hls.min.js'));
console.log('Copied hls.js to src/renderer/vendor/');
