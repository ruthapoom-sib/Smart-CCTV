const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
test('rebuilding publishes exactly public allowlist, with no stale output', () => {
  const root = path.resolve(__dirname, '..');
  const build = () => execFileSync(process.execPath, [path.join(root, 'tools/build.cjs')], { cwd: root });
  build();
  fs.writeFileSync(path.join(root, 'dist', 'obsolete-test-file.txt'), 'Remove this generated test fixture on rebuild.');
  build();
  const files = fs.readdirSync(path.join(root, 'dist'), { recursive: true }).filter(file => fs.statSync(path.join(root, 'dist', file)).isFile());
  assert.equal(files.includes('obsolete-test-file.txt'), false);
  assert.deepEqual(files.map(f=>f.replaceAll('\\','/')).sort(), [...require('../tools/public-files.cjs')].sort());
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'scripts', 'app.js'), 'utf8'), fs.readFileSync(path.join(root, 'scripts', 'app.js'), 'utf8'));
});
