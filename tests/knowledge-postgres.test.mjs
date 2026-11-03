import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ensureKnowledgeTables } from "../core/postgres.mjs";
import { createKnowledgeRepository } from "../core/knowledge-repository.mjs";

const configured =
  process.env.AMAYORI_TEST_DATABASE_URL || process.env.AMAYORI_TEST_PGLITE_PATH;
test(
  "PostgreSQL migrates legacy facts and atomically stores duplicate sources, chosen versions and metadata",
  { skip: !configured },
  async (t) => {
    let db, close;
    if (process.env.AMAYORI_TEST_PGLITE_PATH) {
      const { PGlite } = await import(
        pathToFileURL(process.env.AMAYORI_TEST_PGLITE_PATH).href
      );
      const engine = new PGlite();
      let tail = Promise.resolve();
      db = {
        query: (...args) => engine.query(...args),
        connect: async () => {
          const prior = tail;
          let unlock;
          tail = new Promise((resolve) => {
            unlock = resolve;
          });
          await prior;
          return {
            query: (...args) => engine.query(...args),
            release: () => unlock(),
          };
        },
      };
      close = () => engine.close();
    } else {
      const { Pool } = createRequire(import.meta.url)("pg");
      const schema = "amayori_test_" + process.pid + "_" + Date.now();
      const admin = new Pool({
        connectionString: process.env.AMAYORI_TEST_DATABASE_URL,
        max: 1,
      });
      await admin.query("CREATE SCHEMA " + schema);
      db = new Pool({
        connectionString: process.env.AMAYORI_TEST_DATABASE_URL,
        max: 3,
        options: "-c search_path=" + schema,
      });
      close = async () => {
        await db.end();
        await admin.query("DROP SCHEMA " + schema + " CASCADE");
        await admin.end();
      };
    }
    t.after(close);
    // Represents the schema shipped before this update, including original IDs.
    await db.query(
      `CREATE TABLE amayori_facts(id BIGSERIAL PRIMARY KEY,subject TEXT NOT NULL,predicate TEXT NOT NULL,object TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'chat',confidence REAL NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','rejected')),superseded_by BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    await db.query(
      "INSERT INTO amayori_facts(subject,predicate,object,source) VALUES('Amayori','тема','Чёрная','user-confirmed'),('amayori','тема','черная.','cloudru-extracted')",
    );
    await ensureKnowledgeTables(db);
    const getDatabase = async () => db;
    const repo = createKnowledgeRepository({
      postgres: () => true,
      getDatabase,
    });
    await repo.compact();
    assert.equal((await repo.list()).total, 1);
    assert.equal((await repo.detail("2")).merged_into, "1");
    const input = {
      subject: "Amayori",
      predicate: "тема",
      object: "Чёрная",
      exclusive: true,
      topic: "Дизайн",
      kind: "preference",
    };
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        repo.save([input], {
          kind: "cloudru-extracted",
          messageId: String(100 + i),
          excerpt: "Источник " + i,
        }),
      ),
    );
    const detail = await repo.detail("1");
    assert.equal(detail.sources.length, 10);
    assert.equal(detail.topic, "Дизайн");
    const [newer] = await repo.save([{ ...input, object: "Белая" }]);
    assert.equal(newer.status, "candidate");
    assert.equal(
      (
        await db.query(
          "SELECT COUNT(*)::int AS n FROM amayori_facts WHERE status='active'",
        )
      ).rows[0].n,
      1,
      "legacy Golem queries exclude unchosen candidates",
    );
    await repo.choose(newer.id);
    const restored = createKnowledgeRepository({
      postgres: () => true,
      getDatabase,
    });
    assert.equal(
      (await restored.detail(newer.id)).history.some((f) => f.id === "1"),
      true,
    );
    assert.equal((await restored.find("Amayori"))[0].object, "Белая");
    assert.equal(
      (
        await db.query(
          "SELECT knowledge_meta->>'kind' AS kind FROM amayori_facts WHERE id=$1",
          [newer.id],
        )
      ).rows[0].kind,
      "preference",
    );
    const snapshot = JSON.stringify(await restored.all());
    await assert.rejects(() => restored.merge(newer.id, "404"), /не найдено/);
    assert.equal(
      JSON.stringify(await restored.all()),
      snapshot,
      "failed mutation rolls back without partial history changes",
    );
    await db.query("TRUNCATE amayori_facts RESTART IDENTITY");
    let localState = { version: 1, facts: [] };
    const localOptions = {
      load: async () => structuredClone(localState),
      persist: async (value) => {
        localState = structuredClone(value);
      },
    };
    const localRepo = createKnowledgeRepository({
      ...localOptions,
      postgres: () => false,
    });
    const [localOld] = await localRepo.save([input], {
      kind: "cloudru-extracted",
      messageId: "local-original",
      excerpt: "Исходный локальный текст",
    });
    const [localNew] = await localRepo.save([{ ...input, object: "Золотая" }]);
    await localRepo.choose(localNew.id);
    const migration = createKnowledgeRepository({
      ...localOptions,
      postgres: () => true,
      getDatabase,
    });
    await assert.rejects(() => migration.list(), /migrate:knowledge/);
    assert.equal(await migration.importLocal(), 2);
    const migrated = await migration.detail(localNew.id);
    assert.equal(migrated.history[0].id, localOld.id);
    assert.equal(
      (await migration.detail(localOld.id)).sources[0].messageId,
      "local-original",
    );
    await assert.rejects(() => migration.importLocal(), /не пуста/);
    const [afterImport] = await migration.save([
      { ...input, predicate: "новое", object: "Новое знание" },
    ]);
    assert.equal(
      Number(afterImport.id) > Number(localNew.id),
      true,
      "import resets the database sequence without ID collisions",
    );
    await migration.save([
      {
        ...input,
        predicate: "другая тема",
        object: "SVG",
        topic: "Внешний вид",
      },
    ]);
    await migration.mergeTopics("Дизайн", "Внешний вид");
    const [afterMerge] = await migration.save([
      { ...input, predicate: "новый источник", object: "Системный" },
    ]);
    assert.equal((await migration.detail(afterMerge.id)).topic, "Внешний вид");
    assert.equal(
      (await migration.detail(localOld.id)).sources[0].messageId,
      "local-original",
    );
    assert.equal(
      (await migration.detail(localOld.id)).events.some(
        (event) => event.type === "topic-merged",
      ),
      true,
    );
  },
);
