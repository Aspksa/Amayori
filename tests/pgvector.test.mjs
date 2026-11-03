// The CI database used to be plain postgres:16, which has no vector extension,
// so every embedding path shipped untested. This exercises the real one.
import test from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.AMAYORI_TEST_DATABASE_URL;
if (url) process.env.AMAYORI_DATABASE_URL = url;

const {database, initDatabase, databaseStatus, insertMemory, searchMemory,
       golemVectorStatus, EMBEDDING_DIMENSIONS} = await import('../core/postgres.mjs');

const axis = (position) => Array.from({length: EMBEDDING_DIMENSIONS}, (_, i) => (i === position ? 1 : 0));
const MARK = 'pgvector-check-';

test('the vector extension is really available and a memory round-trips', {skip: !url}, async (t) => {
  t.after(async () => {
    const db = await database();
    if (!db) return;
    await db.query("DELETE FROM amayori_memories WHERE content LIKE $1", [MARK + '%']);
    await db.end();
  });

  const started = await initDatabase();
  assert.equal(started.enabled, true);

  const status = await databaseStatus();
  assert.equal(status.connected, true);
  assert.equal(status.vectorEnabled, true, 'расширение vector должно быть установлено в образе базы');

  const db = await database();
  await db.query("DELETE FROM amayori_memories WHERE content LIKE $1", [MARK + '%']);

  const near = axis(0), far = axis(1);
  await insertMemory('user', MARK + 'рядом', near);
  await insertMemory('assistant', MARK + 'далеко', far);

  const found = await searchMemory(near, 5);
  const mine = found.filter((row) => String(row.content).startsWith(MARK));
  assert.equal(mine.length, 2, 'обе записи должны находиться векторным поиском');
  assert.equal(mine[0].content, MARK + 'рядом', 'ближайшая по смыслу запись должна быть первой');
  assert.ok(Number(mine[0].distance) < Number(mine[1].distance), 'расстояние должно расти');
  assert.ok(Number(mine[0].distance) < 1e-6, 'точное совпадение даёт нулевое расстояние');

  const vector = await golemVectorStatus();
  assert.equal(vector.enabled, true);
  assert.equal(vector.dimensions, EMBEDDING_DIMENSIONS);
  assert.ok(vector.indexed >= 2);

  await assert.rejects(() => insertMemory('user', MARK + 'плохой', [1, 2, 3]), /384/);
});
