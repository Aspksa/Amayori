import { read, write, serialized, postgresCanonical } from "./store.mjs";
import { ensureKnowledgeTables } from "./postgres.mjs";
import {
  hydrate,
  cleanFact,
  upsertFacts,
  chooseFact,
  mergeFacts,
  factDetail,
  listFacts,
  graphPage,
  invalid,
  slot,
  consolidateFacts,
} from "./knowledge-model.mjs";

// One canonical backend: local JSON without PostgreSQL; the existing facts table
// when PostgreSQL is selected. An unavailable configured DB never falls back to JSON.
export function createKnowledgeRepository({
  postgres = postgresCanonical,
  getDatabase = ensureKnowledgeTables,
  load = () => read("knowledge.json", { version: 1, facts: [] }),
  persist = (value) => write("knowledge.json", value),
} = {}) {
  async function local() {
    const data = await load();
    if (data?.version !== 1 || !Array.isArray(data.facts))
      throw Error("Файл знаний повреждён: восстановите его из резервной копии");
    return data.facts;
  }
  async function all() {
    if (!postgres()) return local();
    const db = await getDatabase();
    if (!db) throw Error("База знаний сейчас недоступна");
    const result = await db.query(
      "SELECT id,subject,predicate,object,source,source_message_id,status,superseded_by,created_at,knowledge_meta FROM amayori_facts ORDER BY id",
    );
    if (!result.rows.length && (await local()).length)
      throw Error(
        "Локальные знания требуют переноса: npm.cmd run migrate:knowledge",
      );
    return result.rows.map(hydrate);
  }
  async function mutate(action, reserve = 0, importing = false) {
    if (!postgres())
      return serialized(async () => {
        const facts = await local();
        let next =
          facts.reduce((n, f) => Math.max(n, Number(f.id) || 0), 0) + 1;
        const result = action(facts, () => String(next++));
        await persist({ version: 1, facts });
        return result;
      });
    const db = await getDatabase();
    if (!db) throw Error("База знаний сейчас недоступна");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Includes the first insertion into an empty slot; row locks alone cannot.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('amayori-knowledge-v1'))",
      );
      const rows = await client.query(
        "SELECT id,subject,predicate,object,source,source_message_id,status,superseded_by,created_at,knowledge_meta FROM amayori_facts ORDER BY id FOR UPDATE",
      );
      const facts = rows.rows.map(hydrate),
        before = new Map(facts.map((f) => [f.id, JSON.stringify(f)]));
      if (!importing && !facts.length && (await local()).length)
        throw Error(
          "Локальные знания требуют переноса: npm.cmd run migrate:knowledge",
        );
      const ids = reserve
        ? (
            await client.query(
              "SELECT nextval(pg_get_serial_sequence('amayori_facts','id')) AS id FROM generate_series(1,$1)",
              [reserve],
            )
          ).rows.map((r) => String(r.id))
        : [];
      const result = action(facts, () => ids.shift());
      for (const fact of facts) {
        if (before.get(fact.id) === JSON.stringify(fact)) continue;
        // Existing Golem queries see only current facts. Rich lifecycle states
        // live in metadata; no destructive constraint migration is required.
        const status =
          fact.status === "candidate"
            ? "rejected"
            : fact.status === "merged"
              ? "superseded"
              : fact.status;
        const meta = {
          topic: fact.topic,
          topics: fact.topics,
          kind: fact.kind,
          exclusive: fact.exclusive,
          status: fact.status,
          sources: fact.sources,
          updated_at: fact.updated_at,
          merged_into: fact.merged_into,
          aliases: fact.aliases,
          events: fact.events,
        };
        const messageId = /^[1-9][0-9]*$/.test(String(fact.source_message_id))
          ? String(fact.source_message_id)
          : null;
        await client.query(
          `INSERT INTO amayori_facts(id,subject,predicate,object,source,source_message_id,status,superseded_by,created_at,knowledge_meta)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
          ON CONFLICT(id) DO UPDATE SET subject=EXCLUDED.subject,predicate=EXCLUDED.predicate,object=EXCLUDED.object,source=EXCLUDED.source,source_message_id=EXCLUDED.source_message_id,status=EXCLUDED.status,superseded_by=EXCLUDED.superseded_by,knowledge_meta=EXCLUDED.knowledge_meta`,
          [
            fact.id,
            fact.subject,
            fact.predicate,
            fact.object,
            fact.source,
            messageId,
            status,
            fact.superseded_by,
            fact.created_at,
            JSON.stringify(meta),
          ],
        );
      }
      if (importing)
        await client.query(
          "SELECT setval(pg_get_serial_sequence('amayori_facts','id'),GREATEST(COALESCE((SELECT MAX(id) FROM amayori_facts),0),1),EXISTS(SELECT 1 FROM amayori_facts))",
        );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return {
    all,
    async importLocal() {
      if (!postgres()) throw Error("Для переноса задайте AMAYORI_DATABASE_URL");
      const localFacts = await local();
      for (const fact of localFacts) {
        cleanFact(fact);
        if (!/^[1-9][0-9]*$/.test(fact.id))
          throw invalid("Некорректный ID в локальных знаниях");
      }
      return mutate(
        (facts) => {
          if (facts.length)
            throw Error("Таблица знаний PostgreSQL не пуста; перенос отменён");
          // Snippets and original local IDs remain in provenance. They must not
          // accidentally reference unrelated numeric IDs in the new chat store.
          facts.push(
            ...structuredClone(localFacts).map((f) => ({
              ...f,
              source_message_id: null,
            })),
          );
          return facts.length;
        },
        0,
        true,
      );
    },
    async compact() {
      return mutate((facts) =>
        consolidateFacts(facts, new Date().toISOString()),
      );
    },
    async save(inputs, source = { kind: "user-confirmed", excerpt: "" }) {
      if (!Array.isArray(inputs) || inputs.length > 20)
        throw invalid("За один раз можно сохранить до 20 знаний");
      const validated = inputs.map(cleanFact);
      if (
        !["user-confirmed", "cloudru-extracted", "chat"].includes(source.kind)
      )
        throw invalid("Неизвестный источник знания");
      const now = new Date().toISOString();
      const provenance = {
        kind: source.kind,
        messageId: source.messageId == null ? null : String(source.messageId),
        excerpt: String(source.excerpt || "").slice(0, 4000),
        at: source.at || now,
      };
      return mutate(
        (facts, allocateId) =>
          upsertFacts(facts, validated, {
            source: provenance,
            now,
            allocateId,
          }),
        inputs.length,
      );
    },
    async list(options = {}) {
      return {
        ...listFacts(await all(), options),
        storage: postgres() ? "postgresql" : "local",
      };
    },
    async find(query = "", limit = 15) {
      return listFacts(await all(), { q: query, limit, status: "active" })
        .facts;
    },
    async detail(id) {
      return factDetail(await all(), id);
    },
    async choose(id) {
      return mutate((facts) => chooseFact(facts, id, new Date().toISOString()));
    },
    async merge(targetId, duplicateId) {
      return mutate((facts) =>
        mergeFacts(facts, targetId, duplicateId, new Date().toISOString()),
      );
    },
    async graph(options = {}) {
      return {
        ...graphPage(await all(), options),
        source: postgres() ? "postgresql" : "local-knowledge",
      };
    },
    async related(id) {
      return factDetail(await all(), id).related;
    },
    async conflicts() {
      const facts = await all(),
        result = [];
      for (const fact of facts) {
        if (fact.status === "candidate") {
          const current = facts.filter(
            (f) => f.status === "active" && slot(f) === slot(fact),
          );
          const alternatives = current.length
            ? current
            : facts.filter(
                (f) =>
                  f.status === "candidate" &&
                  slot(f) === slot(fact) &&
                  f.id < fact.id,
              );
          for (const old of alternatives)
            result.push({
              id: old.id,
              subject: fact.subject,
              predicate: fact.predicate,
              previous: old.object,
              current: fact.object,
              replacement_id: fact.id,
              pending: true,
            });
        } else if (fact.status === "superseded") {
          const current = facts.find((f) => f.id === fact.superseded_by);
          if (current)
            result.push({
              id: fact.id,
              subject: fact.subject,
              predicate: fact.predicate,
              previous: fact.object,
              current: current.object,
              replacement_id: current.id,
              pending: false,
            });
        }
      }
      return result.slice(-100).reverse();
    },
    async immunity() {
      const facts = await all(),
        active = facts.filter((f) => f.status === "active");
      return {
        duplicates: [],
        conflicts: facts
          .filter((f) => f.status === "candidate")
          .map((f) => ({ ...f, variants: 2 })),
        unverified: active
          .filter((f) => !f.sources.some((s) => s.kind === "user-confirmed"))
          .slice(-30),
      };
    },
  };
}
export const knowledge = createKnowledgeRepository();
