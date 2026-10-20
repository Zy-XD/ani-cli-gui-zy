/**
 * @fileoverview Builds the static web app into dist-web/ (deployed to GitHub Pages).
 * The UI needs no bundling, so this is a copy of src/renderer.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist-web');
const vendorFile = path.join(root, 'src', 'renderer', 'vendor', 'hls.min.js');

if (!fs.existsSync(vendorFile)) {
  console.error('src/renderer/vendor/hls.min.js is missing: run `npm install` first.');
  process.exit(1);
}
fs.rmSync(outDir, {recursive: true, force: true});
fs.cpSync(path.join(root, 'src', 'renderer'), outDir, {recursive: true});
// Tells GitHub Pages to serve files as they are (no Jekyll processing).
fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
console.log(`Web app built in ${path.relative(root, outDir)}/`);
