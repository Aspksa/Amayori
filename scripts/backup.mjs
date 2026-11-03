// Backup used to copy the data folder only. In canonical mode the real memory —
// facts, answer traces, embeddings — lives in PostgreSQL, so that backup looked
// successful while saving almost nothing. This covers both, and says plainly
// when it could not.
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = () => process.env.AMAYORI_DATA_DIR ? path.resolve(process.env.AMAYORI_DATA_DIR) : path.join(root, 'data');
const backupsDir = () => process.env.AMAYORI_BACKUP_DIR ? path.resolve(process.env.AMAYORI_BACKUP_DIR) : path.join(root, 'backups');
const STAMP = /^\d{8}-\d{6}-\d{3}$/;

const stamp = (at = new Date()) => {
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return pad(at.getFullYear(), 4) + pad(at.getMonth() + 1) + pad(at.getDate()) + '-' +
    pad(at.getHours()) + pad(at.getMinutes()) + pad(at.getSeconds()) + '-' + pad(at.getMilliseconds(), 3);
};
const exists = async (target) => { try { await fs.access(target); return true; } catch { return false; } };

async function tool(name, args) {
  try { await run(name, args); return {ok: true}; }
  catch (error) { return {ok: false, reason: error.code === 'ENOENT' ? name + ' не найден' : String(error.stderr || error.message).trim().slice(0, 400)}; }
}

export async function backup({url = process.env.AMAYORI_DATABASE_URL, now = new Date()} = {}) {
  const name = stamp(now);
  const target = path.join(backupsDir(), name);
  await fs.mkdir(target, {recursive: true});
  const data = dataDir();
  const copied = await exists(data);
  if (copied) await fs.cp(data, path.join(target, 'data'), {recursive: true});
  let database = 'not-configured';
  let reason = '';
  if (url) {
    const dump = await tool('pg_dump', ['--no-owner', '--format=custom', '--file', path.join(target, 'database.dump'), url]);
    database = dump.ok ? 'saved' : 'failed';
    reason = dump.reason || '';
  }
  const manifest = {version: 1, name, at: now.toISOString(), data: copied ? 'saved' : 'missing', database, reason};
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

export async function list() {
  try {
    const entries = await fs.readdir(backupsDir(), {withFileTypes: true});
    const names = entries.filter((entry) => entry.isDirectory() && STAMP.test(entry.name)).map((entry) => entry.name).sort();
    return Promise.all(names.map(async (name) => {
      try { return JSON.parse(await fs.readFile(path.join(backupsDir(), name, 'manifest.json'), 'utf8')); }
      catch { return {version: 0, name, data: 'unknown', database: 'unknown'}; }
    }));
  } catch { return []; }
}

export async function restore(name, {url = process.env.AMAYORI_DATABASE_URL, now = new Date()} = {}) {
  if (!STAMP.test(String(name || ''))) throw Error('Неверное имя копии');
  const source = path.join(backupsDir(), name);
  if (!await exists(source)) throw Error('Копия не найдена');
  const safety = path.join(backupsDir(), 'before-restore-' + stamp(now));
  const data = dataDir();
  if (await exists(data)) {
    await fs.mkdir(safety, {recursive: true});
    await fs.cp(data, path.join(safety, 'data'), {recursive: true});
    await fs.rm(data, {recursive: true, force: true});
  }
  const restored = await exists(path.join(source, 'data'));
  if (restored) await fs.cp(path.join(source, 'data'), data, {recursive: true});
  let database = 'skipped';
  let reason = '';
  const dump = path.join(source, 'database.dump');
  if (url && await exists(dump)) {
    const result = await tool('pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', url, dump]);
    database = result.ok ? 'restored' : 'failed';
    reason = result.reason || '';
  } else if (await exists(dump)) {
    database = 'not-configured';
    reason = 'В копии есть база, но AMAYORI_DATABASE_URL не задан';
  }
  return {name, data: restored ? 'restored' : 'missing', database, reason, safety};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [action = 'backup', name] = process.argv.slice(2);
  const report = (value) => console.log(JSON.stringify(value, null, 2));
  try {
    if (action === 'list') report(await list());
    else if (action === 'restore') {
      console.log('Остановите сервер Amayori перед восстановлением.');
      report(await restore(name));
    } else {
      const made = await backup();
      report(made);
      if (made.database === 'failed') {
        console.error('База НЕ сохранена: ' + made.reason);
        process.exitCode = 1;
      } else if (made.database === 'not-configured') {
        console.log('База не настроена — сохранены только локальные файлы.');
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
