import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalTopic,
  topicSuggestions,
  topicMatches,
} from "../core/topic-model.mjs";
import { createKnowledgeRepository } from "../core/knowledge-repository.mjs";
import {
  groupConversations,
  linkConversations,
  listConversations,
  conversationPage,
  createConversationCache,
} from "../core/conversations.mjs";
import { buildTopicOverview } from "../core/topic-overview.mjs";

const input = {
  subject: "Amayori",
  predicate: "стиль",
  object: "Чёрно-золотой",
  topic: "Amayori / Дизайн",
  exclusive: true,
};
function repository() {
  let state = { version: 1, facts: [] };
  const options = {
    postgres: () => false,
    load: async () => structuredClone(state),
    persist: async (data) => {
      state = structuredClone(data);
    },
  };
  return { repo: createKnowledgeRepository(options), options };
}
test("logical topics stay at two levels and related names are suggested only within the same project", () => {
  assert.equal(canonicalTopic(" Amayori → Дизайн "), "Amayori / Дизайн");
  assert.equal(
    canonicalTopic("Amayori / Дизайн / Кнопки"),
    "Amayori / Дизайн · Кнопки",
  );
  assert.equal(topicMatches("AMAYORI/Дизайн", "amayori"), true);
  assert.equal(topicMatches("Другой проект / Дизайн", "Amayori"), false);
  const suggestions = topicSuggestions([
    "Amayori / Дизайн",
    "Amayori / Внешний вид",
    "Другой проект / Дизайн",
  ]);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].from, "Amayori / Дизайн");
});
test("topic reuse and explicit merging retain IDs, sources and historical versions and redirect future old names", async () => {
  const { repo, options } = repository();
  const [first] = await repo.save([input], {
    kind: "cloudru-extracted",
    messageId: "one",
    excerpt: "Тема",
  });
  await repo.save([
    { ...input, predicate: "меню", object: "Значки", topic: "amayori→дизайн" },
  ]);
  assert.deepEqual((await repo.list()).topics, ["Amayori / Дизайн"]);
  const [second] = await repo.save([
    { ...input, object: "Белый", topic: "Amayori / Внешний вид" },
  ]);
  await repo.choose(second.id);
  const result = await repo.mergeTopics(
    "Amayori / Дизайн",
    "Amayori / Внешний вид",
  );
  assert.equal(result.changed, 2);
  const old = await repo.detail(first.id);
  assert.equal(old.status, "superseded");
  assert.equal(old.sources[0].messageId, "one");
  assert.equal(old.topic, "Amayori / Внешний вид");
  const restored = createKnowledgeRepository(options);
  const [later] = await restored.save([
    { ...input, predicate: "шрифт", object: "Системный" },
  ]);
  assert.equal(
    (await restored.detail(later.id)).topic,
    "Amayori / Внешний вид",
  );
  assert.equal(
    (await restored.list({ topic: "Amayori", status: "all" })).total,
    4,
  );
  await assert.rejects(
    () => restored.mergeTopics("missing", "Amayori"),
    /не существует/,
  );
});
test("manual topic assignment clears the unassigned issue and automatic extraction respects the chosen destination", async () => {
  const { repo } = repository();
  const [row] = await repo.save([{ ...input, topic: "" }]);
  assert.equal(
    buildTopicOverview(await repo.all(), []).folders[0].attention,
    1,
  );
  await repo.setTopic(row.id, "Amayori / Решения");
  await repo.save([{ ...input, topic: "Автоматическая тема" }], {
    kind: "cloudru-extracted",
    messageId: "later",
  });
  const fact = await repo.detail(row.id);
  assert.deepEqual(fact.topics, ["Amayori / Решения"]);
  assert.equal(fact.sources.length, 2);
  assert.equal(
    buildTopicOverview(await repo.all(), []).folders.find(
      (f) => f.path === "Amayori",
    ).attention,
    0,
  );
});
test("conversation grouping retains every message, stable IDs and search outside the latest 100 entries", () => {
  const messages = Array.from({ length: 140 }, (_, i) => ({
    id: "m" + i,
    role: i % 2 ? "assistant" : "user",
    content: i === 0 ? "Самое первое обсуждение" : "Сообщение " + i,
    at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
  const groups = groupConversations(messages);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].messages.length, 140);
  const extended = groupConversations([
    ...messages,
    {
      id: "tail",
      role: "user",
      content: "Продолжение",
      at: "2026-01-01T02:21:00Z",
    },
  ]);
  assert.equal(extended[0].id, groups[0].id);
  assert.equal(listConversations(groups, { q: "Самое первое" }).total, 1);
  const page = conversationPage(groups, groups[0].id, {
    messageId: "m126",
    limit: 50,
  });
  assert.equal(page.offset, 100);
  assert.equal(page.total, 140);
  assert.equal(page.messages.length, 40);
  assert.throws(
    () => conversationPage(groups, groups[0].id, { messageId: "missing" }),
    /не найдено/,
  );
  const nextDay = groupConversations([
    ...messages,
    {
      id: "next-day",
      role: "user",
      content: "Другая беседа",
      at: "2026-01-02T00:00:00Z",
    },
  ]);
  assert.equal(nextDay.length, 2);
});
test("source links attach one conversation to multiple folders without copying messages or guessing ambiguous excerpts", async () => {
  const { repo } = repository();
  const messages = [
    {
      id: "u1",
      role: "user",
      content: "Первое решение",
      at: "2026-01-01T00:00:00Z",
    },
    {
      id: "a1",
      role: "assistant",
      content: "Принято",
      at: "2026-01-01T00:01:00Z",
    },
    {
      id: "u2",
      role: "user",
      content: "Повторяется",
      at: "2026-01-02T00:00:00Z",
    },
    {
      id: "u3",
      role: "user",
      content: "Повторяется",
      at: "2026-01-03T00:00:00Z",
    },
  ];
  await repo.save([input], {
    kind: "cloudru-extracted",
    messageId: "u1",
    excerpt: messages[0].content,
    at: messages[0].at,
  });
  await repo.save(
    [
      {
        ...input,
        predicate: "источник",
        object: "Сохранять",
        topic: "Amayori / Память",
      },
    ],
    {
      kind: "cloudru-extracted",
      messageId: "u1",
      excerpt: messages[0].content,
      at: messages[0].at,
    },
  );
  await repo.save(
    [{ ...input, predicate: "неоднозначный", object: "Текст", topic: "Идеи" }],
    {
      kind: "cloudru-extracted",
      messageId: "old-local",
      excerpt: "Повторяется",
    },
  );
  const groups = linkConversations(
    groupConversations(messages),
    await repo.all(),
  );
  assert.equal(
    listConversations(groups, { topic: "Amayori / Дизайн" }).total,
    1,
  );
  assert.equal(
    listConversations(groups, { topic: "Amayori / Память" }).total,
    1,
  );
  assert.equal(listConversations(groups, { topic: "Идеи" }).total, 0);
  assert.equal(groups[0].messages.length, 2);
  assert.equal(groups[0].topics.length, 2);
});
test("folder attention reflects actual candidates, missing sources, related topic names and failed messages", async () => {
  const { repo } = repository();
  const messages = [
    {
      id: "u1",
      role: "user",
      content: "Выбор дизайна",
      at: "2026-01-01T00:00:00Z",
    },
    { id: "u2", role: "user", content: "Ошибка", at: "2026-01-01T00:01:00Z" },
  ];
  await repo.save([input], {
    kind: "cloudru-extracted",
    messageId: "u1",
    excerpt: messages[0].content,
  });
  await repo.save([{ ...input, object: "Белый" }]);
  await repo.save([
    {
      ...input,
      predicate: "иконки",
      object: "SVG",
      topic: "Amayori / Внешний вид",
    },
  ]);
  const facts = await repo.all(),
    linked = linkConversations(groupConversations(messages), facts);
  const overview = buildTopicOverview(facts, linked, {
    failedMessageIds: ["u2"],
  });
  const root = overview.folders.find((f) => f.path === "Amayori");
  assert.equal(root.count, 3);
  assert.equal(root.conversations, 1);
  assert.equal(root.children.length, 2);
  assert.deepEqual(
    new Set(root.issues.map((i) => i.type)),
    new Set(["conflict", "similar-topics", "extraction"]),
  );
  const leaf = overview.folders.find((f) => f.path === "Amayori / Дизайн");
  assert.equal(leaf.attention, 3);
  const missing = buildTopicOverview(
    [
      {
        id: "legacy",
        ...input,
        status: "active",
        source: "cloudru-extracted",
        sources: [],
      },
    ],
    [],
  );
  assert.equal(
    missing.folders.find((f) => f.path === input.topic).issues[0].type,
    "source",
  );
});
test("conversation cache coalesces reads and refreshes after invalidation", async () => {
  let calls = 0;
  const cache = createConversationCache(async () => {
    calls++;
    return [{ id: "u", role: "user", content: "Тема", at: "2026-01-01" }];
  });
  await Promise.all([cache.groups(), cache.groups(), cache.groups()]);
  assert.equal(calls, 1);
  cache.invalidate();
  await cache.groups();
  assert.equal(calls, 2);
});
test("invalidating an in-flight archive read prevents publishing stale conversation data", async () => {
  let release,
    calls = 0;
  const cache = createConversationCache(async () => {
    calls++;
    if (calls === 1)
      return new Promise((resolve) => {
        release = resolve;
      });
    return [
      { id: "new", role: "user", content: "Новое сообщение", at: "2026-01-01" },
    ];
  });
  const previous = cache.groups();
  cache.invalidate();
  release([]);
  assert.equal((await previous)[0].messages[0].id, "new");
  assert.equal((await cache.groups())[0].messages[0].id, "new");
  assert.equal(calls, 2);
});

test("explicit canonical conversations remain separate across gaps and interleaved messages",()=>{
 const groups=groupConversations([
 {id:"a",role:"user",content:"Первая тема разговора",at:"2026-01-01",conversation:"one"},
 {id:"b",role:"user",content:"Другая тема разговора",at:"2026-01-01",conversation:"two"},
 {id:"c",role:"assistant",content:"Поздний ответ",at:"2026-02-01",conversation:"one"},
 ]);
 assert.equal(groups.length,2);
 assert.equal(groups[0].canonicalId,"one");
 assert.deepEqual(groups[0].messages.map(m=>m.id),["a","c"]);
 assert.equal(groups[1].canonicalId,"two");
});

test("an exact surviving message opens a legacy conversation after its first message is deleted",()=>{
 const messages=[{id:"first",role:"user",content:"Первый вопрос",at:"2026-01-01"},{id:"answer",role:"assistant",content:"Ответ",at:"2026-01-01"}];
 const before=groupConversations(messages);
 const after=groupConversations(messages.slice(1));
 assert.notEqual(before[0].id,after[0].id);
 const page=conversationPage(after,"",{messageId:"answer"});
 assert.equal(page.id,after[0].id);
 assert.equal(page.messages[0].id,"answer");
});
