import { createHash } from "node:crypto";
import { topicMatches, factTopics } from "./topic-model.mjs";

const plain = (value) =>
  String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*`#]+/g, "")
    .replace(/\s+/gu, " ")
    .trim();
const cut = (value, size) =>
  value.length > size ? value.slice(0, size - 1).trimEnd() + "…" : value;
export function groupConversations(messages, { gapMs = 30 * 60 * 1000 } = {}) {
  const groups = [],
    named = new Map();
  let current = null,
    lastTime = null;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index],
      time = Date.parse(message.at),
      explicit = message.conversation_id || message.conversationId || message.conversation;
    let group;
    if (explicit) {
      const id = "named-" + String(explicit);
      group = named.get(id);
      if (!group) {
        group = { id, canonicalId: String(explicit), messages: [], startIndex: index };
        groups.push(group);
        named.set(id, group);
      }
      current = null;
    } else {
      if (
        !current ||
        (Number.isFinite(time) &&
          Number.isFinite(lastTime) &&
          time - lastTime > gapMs)
      ) {
        const firstId = String(message.id ?? index);
        current = {
          id:
            "session-" +
            createHash("sha256").update(firstId).digest("hex").slice(0, 24),
          messages: [],
          startIndex: index,
        };
        groups.push(current);
      }
      group = current;
    }
    group.messages.push({
      ...message,
      id: String(message.id ?? "legacy-" + index),
    });
    group.endIndex = index;
    if (Number.isFinite(time)) lastTime = time;
  }
  return groups.map((group) => {
    const user = group.messages.filter((m) => m.role === "user");
    const meaningful =
      user.find(
        (m) =>
          plain(m.content).length >= 15 &&
          !/^(да|делай|продолжай|хорошо|спасибо)[.! ]*$/iu.test(
            plain(m.content),
          ),
      ) ||
      user[0] ||
      group.messages[0];
    return {
      ...group,
      title: cut(plain(meaningful?.content) || "Беседа", 75),
      startedAt: group.messages[0]?.at || null,
      endedAt: group.messages.at(-1)?.at || null,
      topics: [],
      factIds: [],
    };
  });
}
export function linkConversations(groups, facts) {
  const messageIndex = new Map(),
    textIndex = new Map();
  const linked = groups.map((group) => ({ ...group, topics: [], factIds: [] }));
  for (const group of linked)
    for (const message of group.messages) {
      messageIndex.set(String(message.id), group);
      if (message.role !== "user") continue;
      const text = String(message.content).trim();
      if (!textIndex.has(text)) textIndex.set(text, []);
      textIndex.get(text).push({ group, message });
    }
  for (const fact of facts) {
    if (["merged", "rejected"].includes(fact.status)) continue;
    for (const source of fact.sources || []) {
      let group = source.messageId
        ? messageIndex.get(String(source.messageId))
        : null;
      if (!group && source.excerpt) {
        const matches = textIndex.get(String(source.excerpt).trim()) || [];
        const dated = matches.filter(
          (row) =>
            Number.isFinite(Date.parse(source.at)) &&
            Date.parse(row.message.at) === Date.parse(source.at),
        );
        group =
          dated.length === 1
            ? dated[0].group
            : matches.length === 1
              ? matches[0].group
              : null;
      }
      if (!group) continue;
      group.topics.push(...factTopics(fact));
      group.factIds.push(String(fact.id));
    }
  }
  for (const group of linked) {
    group.topics = [...new Set(group.topics)];
    group.factIds = [...new Set(group.factIds)];
  }
  return linked;
}
const header = (group) => ({
  id: group.id,
  canonicalId: group.canonicalId,
  title: group.title,
  startedAt: group.startedAt,
  endedAt: group.endedAt,
  messages: group.messages.length,
  topics: group.topics,
  factIds: group.factIds,
});
export function listConversations(
  groups,
  { q = "", topic = "", offset = 0, limit = 30 } = {},
) {
  const query = String(q).trim().toLocaleLowerCase("ru").slice(0, 200);
  const rows = groups
    .filter(
      (g) =>
        (!topic || g.topics.some((t) => topicMatches(t, topic))) &&
        (!query ||
          g.messages.some((m) =>
            String(m.content).toLocaleLowerCase("ru").includes(query),
          )),
    )
    .sort((a, b) => b.endIndex - a.endIndex);
  const start = Math.max(0, Math.min(1000000, Math.floor(Number(offset) || 0))),
    size = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)));
  return {
    conversations: rows.slice(start, start + size).map((group) => ({
      ...header(group),
      matchMessageId: query
        ? group.messages.find((m) =>
            String(m.content).toLocaleLowerCase("ru").includes(query),
          )?.id
        : null,
      snippet: query
        ? cut(
            plain(
              group.messages.find((m) =>
                String(m.content).toLocaleLowerCase("ru").includes(query),
              )?.content,
            ),
            160,
          )
        : "",
    })),
    total: rows.length,
    offset: start,
    limit: size,
  };
}
export function conversationPage(
  groups,
  id,
  { offset = 0, limit = 50, messageId } = {},
) {
  const group = groups.find((g) => g.id === String(id));
  if (!group)
    throw Object.assign(Error("Беседа не найдена"), { statusCode: 404 });
  const size = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  let start = Math.max(
    0,
    Math.min(
      Math.floor((group.messages.length - 1) / size) * size,
      Math.floor(Number(offset) || 0),
    ),
  );
  if (messageId) {
    const index = group.messages.findIndex(
      (m) => String(m.id) === String(messageId),
    );
    if (index < 0)
      throw Object.assign(
        Error("Исходное сообщение в этой беседе не найдено"),
        { statusCode: 404 },
      );
    start = Math.floor(index / size) * size;
  }
  return {
    ...header(group),
    messages: group.messages.slice(start, start + size),
    total: group.messages.length,
    offset: start,
    limit: size,
  };
}
export function createConversationCache(
  history,
  { ttl = 5000, clock = Date.now } = {},
) {
  let value = null,
    expires = 0,
    pending = null,
    generation = 0;
  return {
    invalidate() {
      expires = 0;
      value = null;
      generation++;
    },
    async groups() {
      if (value && clock() < expires) return value;
      if (!pending) {
        const batch = { generation, promise: null };
        pending = batch;
        batch.promise = history()
          .then((messages) => {
            const groups = groupConversations(messages);
            if (batch.generation === generation) {
              value = groups;
              expires = clock() + ttl;
            }
            return groups;
          })
          .finally(() => {
            if (pending === batch) pending = null;
          });
      }
      const batch = pending,
        result = await batch.promise;
      if (batch.generation !== generation) return this.groups();
      return result;
    },
  };
}
