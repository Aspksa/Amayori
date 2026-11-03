// Logical folders: canonical labels, never filesystem paths.
export function canonicalTopic(value) {
  const parts = String(value || "Без темы")
    .normalize("NFKC")
    .split(/\s*(?:\/|→|>)\s*/u)
    .map((s) => s.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  return (
    parts.length > 1
      ? parts[0] + " / " + parts.slice(1).join(" · ")
      : parts[0] || "Без темы"
  ).slice(0, 100);
}
export const topicKey = (value) =>
  canonicalTopic(value)
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[‐‑‒–—]/gu, "-");
export function topicMatches(value, scope) {
  const candidate = topicKey(value),
    parent = topicKey(scope);
  return candidate === parent || candidate.startsWith(parent + " / ");
}
export function factTopics(fact) {
  const values =
    Array.isArray(fact.topics) && fact.topics.length
      ? fact.topics
      : [fact.topic || "Без темы"];
  return [
    ...new Map(values.map((t) => [topicKey(t), canonicalTopic(t)])).values(),
  ];
}
export function resolveTopic(value, facts) {
  let name = canonicalTopic(value);
  const aliases = new Map();
  for (const fact of facts)
    for (const event of fact.events || [])
      if (event.type === "topic-merged")
        aliases.set(topicKey(event.from), canonicalTopic(event.to));
  const seen = new Set();
  while (aliases.has(topicKey(name)) && !seen.has(topicKey(name))) {
    seen.add(topicKey(name));
    name = aliases.get(topicKey(name));
  }
  for (const fact of facts)
    for (const topic of factTopics(fact))
      if (topicKey(topic) === topicKey(name)) return topic;
  return name;
}
export function organizeTopics(facts, now) {
  const names = new Map();
  let changed = 0;
  for (const fact of facts) {
    const before = JSON.stringify([fact.topic, fact.topics]);
    const topics = factTopics(fact).map((value) => {
      const canonical = resolveTopic(value, facts),
        key = topicKey(canonical);
      if (!names.has(key)) names.set(key, canonical);
      return names.get(key);
    });
    fact.topics = [...new Set(topics)];
    fact.topic =
      names.get(topicKey(resolveTopic(fact.topic || fact.topics[0], facts))) ||
      fact.topics[0];
    if (!fact.topics.includes(fact.topic)) fact.topic = fact.topics[0];
    if (before !== JSON.stringify([fact.topic, fact.topics])) {
      fact.updated_at = now;
      changed++;
    }
  }
  return changed;
}
export function mergeTopics(facts, from, to, now) {
  const source = canonicalTopic(from),
    target = canonicalTopic(to);
  if (topicKey(source) === topicKey(target))
    throw Object.assign(Error("Выберите две разные темы"), { statusCode: 400 });
  const sourceExists = facts.some((f) =>
    factTopics(f).some((t) => topicKey(t) === topicKey(source)),
  );
  const targetExists = facts.some((f) =>
    factTopics(f).some((t) => topicKey(t) === topicKey(target)),
  );
  if (!sourceExists || !targetExists)
    throw Object.assign(Error("Тема больше не существует. Обновите список."), {
      statusCode: 409,
    });
  let changed = 0;
  for (const fact of facts) {
    if (!factTopics(fact).some((t) => topicKey(t) === topicKey(source)))
      continue;
    fact.topics = [
      ...new Set(
        factTopics(fact).map((t) =>
          topicKey(t) === topicKey(source) ? target : t,
        ),
      ),
    ];
    if (topicKey(fact.topic) === topicKey(source)) fact.topic = target;
    fact.events ||= [];
    fact.events.push({
      type: "topic-merged",
      from: source,
      to: target,
      at: now,
    });
    fact.updated_at = now;
    changed++;
  }
  return { changed, from: source, to: target };
}
const meaning = (name) => {
  const value = String(name).toLocaleLowerCase("ru").trim();
  for (const [group, words] of Object.entries({
    design: ["дизайн", "внешний вид", "оформление"],
    memory: ["память", "долговременная память"],
    preferences: ["предпочтения", "личные предпочтения"],
  }))
    if (words.includes(value)) return group;
  return null;
};
export function topicSuggestions(topics) {
  const result = [];
  for (let i = 0; i < topics.length; i++)
    for (let j = i + 1; j < topics.length; j++) {
      const a = topics[i],
        b = topics[j],
        ap = a.split(" / "),
        bp = b.split(" / ");
      const parentA = ap.length > 1 ? topicKey(ap[0]) : "",
        parentB = bp.length > 1 ? topicKey(bp[0]) : "";
      if (parentA !== parentB) continue;
      const av = ap.at(-1),
        bv = bp.at(-1);
      const group = meaning(av);
      const words = (s) =>
        new Set(
          s
            .toLocaleLowerCase("ru")
            .split(/[^\p{L}\p{N}]+/u)
            .filter((w) => w.length > 2),
        );
      const aw = words(av),
        bw = words(bv),
        intersection = [...aw].filter((w) => bw.has(w)).length;
      const similarity =
        intersection / Math.max(1, new Set([...aw, ...bw]).size);
      if ((group && group === meaning(bv)) || similarity >= 0.65)
        result.push({
          id: JSON.stringify([a, b]),
          from: a,
          to: b,
          type: "similar-topics",
          label: "Похожие темы: «" + av + "» и «" + bv + "»",
        });
    }
  return result;
}
