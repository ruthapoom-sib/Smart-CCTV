// No bundler or production dependencies. Publish only this explicit file list.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['index.html', 'styles.css', 'assets/favicon.svg', 'scripts/data.js', 'scripts/core.js', 'scripts/player.js', 'scripts/app.js', 'vendor/hls-1.7.3.min.js', 'vendor/hls-LICENSE'];
const output = path.join(fs.realpathSync(root), 'dist');
// Fail before touching anything if an output path was replaced with a link.
// Every recursive removal is restricted to this resolved in-repository directory.
if (fs.existsSync(output)) {
  const stat = fs.lstatSync(output);
  const resolved = fs.realpathSync(output);
  if (stat.isSymbolicLink() || !stat.isDirectory() || resolved !== output || path.dirname(resolved) !== fs.realpathSync(root)) {
    throw new Error('Refusing to replace a dist path outside the project or a linked output directory.');
  }
  fs.rmSync(resolved, { recursive: true });
}
for (const file of files) {
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
}
console.log(`Static site ready: dist/ (${files.length} public files)`);
