import test from "node:test";
import assert from "node:assert/strict";
import { createKnowledgeRepository } from "../core/knowledge-repository.mjs";
import { createExtractionService } from "../core/knowledge-extraction.mjs";
import { extractKnowledge } from "../core/knowledge-extractor.mjs";
import { hydrate, graphPage } from "../core/knowledge-model.mjs";

const input = {
  subject: "Amayori",
  predicate: "тема интерфейса",
  object: "Чёрно-золотая",
  topic: "Дизайн",
  kind: "preference",
  exclusive: true,
};
function fixture() {
  let data = { version: 1, facts: [] };
  const options = {
    postgres: () => false,
    load: async () => structuredClone(data),
    persist: async (value) => {
      data = structuredClone(value);
    },
  };
  return {
    repo: createKnowledgeRepository(options),
    options,
    get data() {
      return data;
    },
  };
}
const source = (id) => ({
  kind: "cloudru-extracted",
  messageId: id,
  excerpt: "Выбираю чёрно-золотую тему",
  at: "2026-11-03T01:00:00Z",
});
test("normalized duplicates merge provenance under concurrent writes without dropping topics or links", async () => {
  const { repo } = fixture();
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      repo.save(
        [
          {
            ...input,
            subject: i % 2 ? " AMAYORI " : "Amayori",
            object: i % 2 ? "черно-золотая." : "Чёрно-золотая",
            topic: i % 2 ? "Интерфейс" : "Дизайн",
          },
        ],
        source(String(i)),
      ),
    ),
  );
  assert.equal(new Set(results.flat().map((r) => r.id)).size, 1);
  const list = await repo.list();
  assert.equal(list.total, 1);
  const card = await repo.detail(list.facts[0].id);
  assert.equal(card.sources.length, 12);
  assert.deepEqual(card.topics, ["Дизайн", "Интерфейс"]);
  assert.equal((await repo.graph()).edges.length, 1);
});
test("a contradictory single-valued claim requires an explicit choice and preserves both versions and sources", async () => {
  const { repo } = fixture();
  const [first] = await repo.save([input], source("old"));
  const [second] = await repo.save(
    [{ ...input, object: "Белая" }],
    source("new"),
  );
  assert.equal(second.status, "candidate");
  assert.deepEqual(
    (await repo.find("Amayori")).map((f) => f.id),
    [first.id],
  );
  assert.equal((await repo.detail(second.id)).conflicts[0].id, first.id);
  await repo.choose(second.id);
  assert.equal((await repo.detail(first.id)).status, "superseded");
  assert.equal((await repo.detail(second.id)).history[0].id, first.id);
  assert.equal((await repo.find("Amayori"))[0].object, "Белая");
  await assert.rejects(
    () => repo.merge(first.id, second.id),
    /Историческую версию/,
  );
  assert.equal((await repo.find("Amayori"))[0].id, second.id);
  await repo.choose(first.id);
  assert.equal((await repo.detail(first.id)).sources[0].messageId, "old");
  assert.equal((await repo.detail(second.id)).superseded_by, first.id);
  const [repeated] = await repo.save(
    [{ ...input, object: "Белая" }],
    source("repeated"),
  );
  assert.equal(
    repeated.status,
    "superseded",
    "repeated old facts must not silently reactivate",
  );
});
test("multi-valued relationships stay additive and related cards expose the shared entity or topic", async () => {
  const { repo } = fixture();
  const [one] = await repo.save(
    [
      {
        ...input,
        predicate: "участник",
        object: "Аня",
        kind: "person",
        exclusive: false,
      },
    ],
    source("a"),
  );
  await repo.save(
    [
      {
        ...input,
        predicate: "участник",
        object: "Борис",
        kind: "person",
        exclusive: false,
      },
    ],
    source("b"),
  );
  await repo.save(
    [{ subject: "Сайт", predicate: "цвет", object: "Золото", topic: "Дизайн" }],
    source("c"),
  );
  const detail = await repo.detail(one.id);
  assert.equal((await repo.list()).total, 3);
  assert.equal(detail.conflicts.length, 0);
  assert.deepEqual(
    new Set(detail.related.map((f) => f.relation)),
    new Set(["Общая сущность: Amayori", "Общая тема: Дизайн"]),
  );
  const graph = await repo.graph();
  assert.equal(graph.edges.length, 3);
  const large = Array.from({ length: 350 }, (_, i) => ({
    ...input,
    id: String(i + 1),
    object: "Узел " + i,
    status: "active",
    topics: ["Дизайн"],
    updated_at: "2026-11-03",
  }));
  assert.equal(
    graphPage(large, { limit: 300 }).edges.length,
    300,
    "Golem retains its 300-fact page contract",
  );
  assert.equal(graph.nodes.filter((n) => n.id === "amayori").length, 1);
  assert.equal((await repo.list({ kind: "person", topic: "Дизайн" })).total, 2);
});
test("upgrading an existing additive property to exclusive exposes all competing values for explicit choice", async () => {
  const { repo } = fixture();
  const city = {
    subject: "Пользователь",
    predicate: "город",
    object: "Москва",
    exclusive: false,
  };
  const [moscow] = await repo.save([city]);
  const [kazan] = await repo.save([{ ...city, object: "Казань" }]);
  const [upgraded] = await repo.save([{ ...city, exclusive: true }]);
  assert.equal(upgraded.id, moscow.id);
  assert.equal(upgraded.status, "candidate");
  assert.equal((await repo.list({ status: "candidate" })).total, 2);
  assert.equal(
    (await repo.find("город")).length,
    0,
    "ambiguous single-valued claims do not both enter chat context",
  );
  assert.equal((await repo.conflicts()).length, 1);
  assert.equal((await repo.detail(kazan.id)).conflicts[0].id, moscow.id);
  const [third] = await repo.save([
    { ...city, object: "Артём", exclusive: true },
  ]);
  assert.equal(third.status, "candidate");
  await repo.choose(kazan.id);
  assert.equal((await repo.find("город"))[0].object, "Казань");
  assert.equal((await repo.list({ status: "superseded" })).total, 2);
});
test("similar values are suggested for review and explicit merging retains aliases and original cards", async () => {
  const { repo } = fixture();
  const [a] = await repo.save(
    [{ ...input, object: "Матовый чёрный золотой интерфейс" }],
    source("1"),
  );
  const [b] = await repo.save(
    [{ ...input, object: "Матовый чёрный золотой интерфейс проекта" }],
    source("2"),
  );
  assert.equal((await repo.detail(a.id)).duplicates[0].id, b.id);
  await repo.merge(a.id, b.id);
  assert.equal((await repo.detail(b.id)).merged_into, a.id);
  const merged = await repo.detail(a.id);
  assert.equal(merged.sources.length, 2);
  assert.equal(merged.history[0].id, b.id);
  const [repeat] = await repo.save(
    [{ ...input, object: "Матовый чёрный золотой интерфейс проекта" }],
    source("3"),
  );
  assert.equal(repeat.id, a.id);
  assert.equal((await repo.detail(a.id)).sources.length, 3);
  assert.equal((await repo.list({ status: "all" })).total, 1);
});
test("invalid batches are atomic, restored local state retains history and a configured database never falls back", async () => {
  const { repo, options } = fixture();
  await assert.rejects(
    () => repo.save([input, { subject: "bad" }]),
    /сущность/,
  );
  assert.equal((await repo.list()).total, 0);
  const [a] = await repo.save([input]);
  const [b] = await repo.save([{ ...input, object: "Белая" }]);
  await repo.choose(b.id);
  const restarted = createKnowledgeRepository(options);
  assert.equal((await restarted.detail(b.id)).history[0].id, a.id);
  await assert.rejects(() => restarted.list({ status: "invalid" }), /фильтр/);
  const unavailable = createKnowledgeRepository({
    ...options,
    postgres: () => true,
    getDatabase: async () => {
      throw Error("DB disconnected");
    },
  });
  await assert.rejects(() => unavailable.list(), /DB disconnected/);
  await assert.rejects(() => unavailable.save([input]), /DB disconnected/);
});
test("legacy PostgreSQL facts hydrate losslessly with their original IDs, provenance and supersession", () => {
  const fact = hydrate({
    id: "12",
    subject: "Проект",
    predicate: "цвет",
    object: "Белый",
    source: "cloudru-extracted",
    source_message_id: 98,
    status: "superseded",
    superseded_by: "13",
    created_at: new Date("2026-01-01"),
  });
  assert.equal(fact.id, "12");
  assert.equal(fact.sources[0].messageId, "98");
  assert.equal(fact.superseded_by, "13");
  assert.equal(fact.status, "superseded");
});
test("deduplication preserves decimals, URLs and separately normalized topics", async () => {
  const { repo } = fixture();
  for (const object of ["1.5", "15", "https://a.b/path", "https://ab/path"])
    await repo.save([
      { ...input, predicate: "значение", object, exclusive: false },
    ]);
  assert.equal((await repo.list()).total, 4);
  await repo.save([{ ...input, topic: "дизайн" }]);
  await repo.save([{ ...input, topic: "ДИЗАЙН" }]);
  const card = (await repo.list({ q: input.object })).facts[0];
  assert.equal(card.topics.length, 1);
});
test("extractor bounds model output, validates structured facts and keeps the user text separate from instructions", async () => {
  const facts = await extractKnowledge({}, "Пользовательский текст", {
    existing: [input],
    chat: async (_, messages) => {
      assert.equal(messages[1].content, "Пользовательский текст");
      assert.match(messages[0].content, /не сохраняй вопросы/);
      assert.match(messages[0].content, /Amayori/);
      return (
        "```json\n" +
        JSON.stringify({
          facts: [input, { subject: "invalid" }, null, ...Array(6).fill(input)],
        }) +
        "\n```"
      );
    },
  });
  assert.equal(facts.length, 3);
  await assert.rejects(
    () =>
      extractKnowledge({}, "test", {
        chat: async () => JSON.stringify({ facts: [{ subject: "invalid" }] }),
      }),
    /некорректные карточки/,
  );
  await assert.rejects(
    () => extractKnowledge({}, "test", { chat: async () => "bad JSON" }),
    /некорректный JSON/,
  );
  await assert.rejects(
    () => extractKnowledge({}, "test", { chat: async () => "null" }),
    /список знаний/,
  );
});
function extractionFixture(overrides = {}) {
  const { repo } = fixture();
  let saved = null,
    calls = 0;
  const options = {
    load: async () => structuredClone(saved),
    persist: async (value) => {
      saved = structuredClone(value);
    },
    getConfig: async () => ({ apiKey: "fake", model: "fake" }),
    repository: repo,
    forcedOff: () => false,
    extract: async () => {
      calls++;
      return [input];
    },
    ...overrides,
  };
  return {
    repo,
    options,
    service: createExtractionService(options),
    get calls() {
      return calls;
    },
    get saved() {
      return saved;
    },
  };
}
test("automatic extraction ignores assistant messages, processes once and preserves source excerpts across restart", async () => {
  const f = extractionFixture();
  const messages = [
    {
      id: "a",
      role: "user",
      content: "Выбираю чёрно-золотую тему",
      at: "2026-11-03T01:00:00Z",
    },
    { id: "b", role: "assistant", content: "Моя догадка" },
  ];
  await f.service.enqueue(messages);
  await f.service.wait();
  assert.equal(f.calls, 1);
  assert.equal((await f.service.status()).completed, 1);
  const card = (await f.repo.list()).facts[0];
  assert.equal(card.sources[0].excerpt, messages[0].content);
  const restarted = createExtractionService(f.options);
  await restarted.enqueue(messages);
  await restarted.wait();
  assert.equal(f.calls, 1);
});
test("extraction can be disabled; failed jobs wait for explicit retry and never duplicate knowledge", async () => {
  let fail = true;
  const f = extractionFixture({
    extract: async () => {
      if (fail) throw Error("Cloud unavailable");
      return [input];
    },
  });
  const messages = [{ id: "a", role: "user", content: "Тема" }];
  await f.service.configure(false);
  await f.service.enqueue(messages);
  await f.service.wait();
  assert.equal((await f.service.status()).completed, 0);
  await f.service.configure(true);
  await f.service.enqueue(messages);
  await f.service.wait();
  assert.equal((await f.service.status()).failed, 1);
  fail = false;
  await f.service.resume();
  await f.service.wait();
  assert.equal((await f.service.status()).failed, 1);
  await f.service.enqueue(messages, { retry: true });
  await f.service.wait();
  assert.equal((await f.service.status()).completed, 1);
  assert.equal((await f.repo.list()).total, 1);
});
