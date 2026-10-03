const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const python = path.join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) throw new Error('Create backend/.venv and install backend/requirements-dev.txt first.');
const result = spawnSync(python, [path.join(root, 'tools/run-detection.py'), process.argv[2] || 'start'], {cwd:root, stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
