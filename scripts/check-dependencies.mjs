import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function missingDependencies(folder = root) {
  const require = createRequire(path.join(folder, 'package.json'));
  const missing = [];
  try { require.resolve('pg'); } catch { missing.push('pg'); }
  if (!fs.existsSync(path.join(folder, 'node_modules', 'three', 'build', 'three.module.js'))) missing.push('three');
  return missing;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    console.error('[ERROR] Install Node.js LTS version 22 or newer.');
    process.exitCode = 2;
  } else {
    const missing = missingDependencies();
    if (missing.length) { console.error('[INFO] Missing dependencies: ' + missing.join(', ')); process.exitCode = 1; }
  }
}
