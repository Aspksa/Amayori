import {
  canonicalTopic,
  topicKey,
  topicMatches,
  factTopics,
  topicSuggestions,
} from "./topic-model.mjs";

export function buildTopicOverview(
  facts,
  conversations,
  { failedMessageIds = [] } = {},
) {
  const visible = facts.filter(
      (f) => !["merged", "rejected"].includes(f.status),
    ),
    names = new Map();
  for (const fact of visible)
    for (const name of factTopics(fact))
      if (!names.has(topicKey(name))) names.set(topicKey(name), name);
  const folders = new Map();
  function folder(path) {
    const key = topicKey(path);
    if (!folders.has(key))
      folders.set(key, {
        path: canonicalTopic(path),
        name: canonicalTopic(path).split(" / ").at(-1),
        count: 0,
        active: 0,
        conversations: 0,
        issues: [],
        children: [],
      });
    return folders.get(key);
  }
  for (const name of names.values()) {
    folder(name);
    if (name.includes(" / ")) {
      const parent = folder(name.split(" / ")[0]);
      parent.children.push(name);
    }
  }
  const knownMessageIds = new Set(
    conversations.flatMap((c) => c.messages.map((m) => String(m.id))),
  );
  const suggestions = topicSuggestions([...names.values()]);
  for (const target of folders.values()) {
    const selected = visible.filter((f) =>
      factTopics(f).some((name) => topicMatches(name, target.path)),
    );
    target.count = selected.length;
    target.active = selected.filter(
      (f) => f.status === "active" || !f.status,
    ).length;
    const related = conversations.filter((c) =>
      c.topics.some((name) => topicMatches(name, target.path)),
    );
    target.conversations = related.length;
    for (const fact of selected) {
      if (
        factTopics(fact).every(
          (name) => topicKey(name) === topicKey("Без темы"),
        )
      )
        target.issues.push({
          id: "topic-" + fact.id,
          type: "unassigned",
          factId: String(fact.id),
          label: "Назначить тему: " + fact.subject + " — " + fact.predicate,
        });
      if (fact.status === "candidate")
        target.issues.push({
          id: "conflict-" + fact.id,
          type: "conflict",
          factId: String(fact.id),
          label: "Выбрать значение: " + fact.subject + " — " + fact.predicate,
        });
      if (
        !(fact.sources || []).some(
          (s) =>
            s.kind === "user-confirmed" ||
            s.excerpt ||
            (s.messageId && knownMessageIds.has(String(s.messageId))),
        ) &&
        fact.source !== "user-confirmed"
      )
        target.issues.push({
          id: "source-" + fact.id,
          type: "source",
          factId: String(fact.id),
          label: "Проверить источник: " + fact.subject + " — " + fact.predicate,
        });
    }
    for (const suggestion of suggestions)
      if (
        topicMatches(suggestion.from, target.path) ||
        topicMatches(suggestion.to, target.path)
      )
        target.issues.push(suggestion);
    const relatedIds = new Set(
      related.flatMap((c) => c.messages.map((m) => String(m.id))),
    );
    for (const id of failedMessageIds)
      if (relatedIds.has(String(id)))
        target.issues.push({
          id: "extraction-" + id,
          type: "extraction",
          messageId: String(id),
          label: "Ошибка разбора сообщения",
        });
    target.attention = target.issues.length;
    target.children = [...new Set(target.children)].sort((a, b) =>
      a.localeCompare(b, "ru"),
    );
  }
  const roots = [...folders.values()]
    .filter((f) => !f.path.includes(" / "))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return {
    folders: [...folders.values()],
    roots: roots.map((f) => f.path),
    total: visible.length,
  };
}
