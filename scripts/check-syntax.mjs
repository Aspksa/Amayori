// Syntax-checks every JavaScript module in the project. CI used a hand-written
// list of files, which silently went stale when modules were added or removed.
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Third-party sources and generated data are not ours to validate.
const skip = new Set(['node_modules', 'vendor', 'data', 'logs', 'backups']);

export async function collectModules(folder = root) {
  const found = [];
  for (const entry of await fs.readdir(folder, {withFileTypes: true})) {
    if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await collectModules(full));
    else if (/\.m?js$/.test(entry.name)) found.push(full);
  }
  return found.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files = await collectModules();
  if (!files.length) {
    console.error('No JavaScript modules found; the check would pass vacuously.');
    process.exitCode = 1;
  }
  const failed = [];
  for (const file of files) {
    try { await run(process.execPath, ['--check', file]); }
    catch (error) { failed.push(path.relative(root, file) + ': ' + String(error.stderr || error.message).trim()); }
  }
  console.log('Checked JavaScript modules:', files.length);
  for (const line of failed) console.error(line);
  if (failed.length) process.exitCode = 1;
}
