const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function exportCatalog() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'scripts/data.js'), 'utf8'), context);
  const { CAMS, GROUPS, SRC } = context.CctvData;
  const cameras = new Map();
  for (const cam of CAMS) {
    if (!cameras.has(cam.id)) cameras.set(cam.id, { id: cam.id, name: cam.name, stream_url: SRC(cam.id), groups: [] });
    cameras.get(cam.id).groups.push(cam.g);
  }
  return JSON.parse(JSON.stringify({ version: 1, cameras: [...cameras.values()], groups: GROUPS.map(([name], id) => ({ id, name })) }));
}
module.exports = { exportCatalog };
if (require.main === module) {
  const file = path.join(root, 'backend/cameras.json');
  const output = JSON.stringify(exportCatalog(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== output) { console.error('Backend camera registry differs from scripts/data.js'); process.exitCode = 1; }
  } else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, output); }
}
