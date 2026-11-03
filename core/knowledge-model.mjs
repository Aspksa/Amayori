// Storage-independent knowledge rules. A conflicting claim never silently wins.
export const kinds = [
  "general",
  "project",
  "person",
  "preference",
  "task",
  "decision",
];
export const key = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[«»“”"]/gu, "")
    .replace(/[‐‑‒–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.,!?;:]+$/gu, "");
export const slot = (fact) =>
  JSON.stringify([key(fact.subject), key(fact.predicate)]);
const identity = (fact) =>
  JSON.stringify([key(fact.subject), key(fact.predicate), key(fact.object)]);
export const invalid = (message) =>
  Object.assign(Error(message), { statusCode: 400 });
export function cleanFact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("Некорректная карточка знания");
  const result = {};
  for (const name of ["subject", "predicate", "object"]) {
    if (
      typeof value[name] !== "string" ||
      !key(value[name]) ||
      value[name].length > 500
    )
      throw invalid(
        "Укажите сущность, отношение и значение — до 500 символов каждое",
      );
    result[name] = value[name].trim().replace(/\s+/gu, " ");
  }
  if (
    value.topic !== undefined &&
    (typeof value.topic !== "string" || value.topic.length > 100)
  )
    throw invalid("Тема должна содержать не больше 100 символов");
  if (value.kind !== undefined && !kinds.includes(value.kind))
    throw invalid("Неизвестный тип знания");
  result.topic = value.topic?.trim() || "Без темы";
  result.kind = value.kind || "general";
  // Only explicitly single-valued properties are competing versions. Hobbies,
  // members of a project, etc. are additive and may have several values.
  result.exclusive = value.exclusive === true;
  return result;
}
const iso = (value) =>
  value instanceof Date ? value.toISOString() : value || null;
export function hydrate(row) {
  const meta = row.knowledge_meta || {};
  return {
    id: String(row.id),
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    source: row.source || "chat",
    source_message_id: row.source_message_id || null,
    created_at: iso(row.created_at),
    updated_at: iso(meta.updated_at || row.created_at),
    topic: meta.topic || "Без темы",
    topics: meta.topics || [meta.topic || "Без темы"],
    kind: kinds.includes(meta.kind) ? meta.kind : "general",
    exclusive: meta.exclusive === true,
    status: meta.status || row.status || "active",
    superseded_by: row.superseded_by == null ? null : String(row.superseded_by),
    merged_into: meta.merged_into || null,
    aliases: meta.aliases || [],
    events: meta.events || [],
    sources: meta.sources ||
      row.sources || [
        {
          kind: row.source || "chat",
          messageId:
            row.source_message_id == null
              ? null
              : String(row.source_message_id),
          excerpt: "",
          at: iso(row.created_at),
        },
      ],
  };
}
const sourceKey = (source) =>
  JSON.stringify([source.kind, source.messageId || key(source.excerpt)]);
function addSources(fact, sources) {
  const all = new Map(
    fact.sources.map((source) => [sourceKey(source), source]),
  );
  for (const source of sources) all.set(sourceKey(source), source);
  fact.sources = [...all.values()];
}
const uniqueTopics = (values) => [
  ...new Map(values.map((value) => [key(value), value])).values(),
];
export function consolidateFacts(facts, now) {
  const seen = new Map();
  for (const fact of facts) {
    if (!["active", "candidate"].includes(fact.status)) continue;
    const prior = seen.get(identity(fact));
    if (prior) mergeFacts(facts, prior.id, fact.id, now);
    else seen.set(identity(fact), fact);
  }
}
export function upsertFacts(facts, inputs, { source, now, allocateId }) {
  consolidateFacts(facts, now);
  const results = [];
  for (const value of inputs) {
    const input = cleanFact(value);
    const same = facts.find(
      (f) =>
        f.status !== "merged" &&
        f.status !== "rejected" &&
        (identity(f) === identity(input) ||
          f.aliases.includes(identity(input))),
    );
    if (same) {
      addSources(same, [source]);
      if (source.kind === "user-confirmed") same.source = "user-confirmed";
      if (input.topic !== "Без темы") {
        same.topics = uniqueTopics([...same.topics, input.topic]);
        if (same.topic === "Без темы") same.topic = input.topic;
      }
      if (same.kind === "general") same.kind = input.kind;
      same.exclusive ||= input.exclusive;
      if (input.exclusive && same.status === "active") {
        const active = facts.filter(
          (f) => slot(f) === slot(same) && f.status === "active",
        );
        if (active.length > 1)
          for (const fact of active) {
            fact.status = "candidate";
            fact.exclusive = true;
            fact.updated_at = now;
            fact.events.push({ type: "exclusive-conflict", at: now });
          }
      }
      same.updated_at = now;
      results.push({
        id: same.id,
        changed: false,
        merged: true,
        status: same.status,
      });
      continue;
    }
    const peers = facts.filter(
      (f) =>
        slot(f) === slot(input) && ["active", "candidate"].includes(f.status),
    );
    if (
      input.exclusive &&
      peers.filter((f) => f.status === "active").length > 1
    ) {
      for (const fact of peers.filter((f) => f.status === "active")) {
        fact.status = "candidate";
        fact.exclusive = true;
        fact.updated_at = now;
        fact.events.push({ type: "exclusive-conflict", at: now });
      }
    }
    const competing = peers.filter((f) => input.exclusive || f.exclusive);
    const fact = {
      ...input,
      id: String(allocateId()),
      topic: input.topic,
      topics: [input.topic],
      source: source.kind,
      source_message_id: source.messageId || null,
      sources: [source],
      created_at: now,
      updated_at: now,
      status: competing.length ? "candidate" : "active",
      superseded_by: null,
      merged_into: null,
      aliases: [],
      events: [],
    };
    facts.push(fact);
    results.push({
      id: fact.id,
      changed: true,
      merged: false,
      status: fact.status,
      conflicts: competing.map((f) => ({ id: f.id, object: f.object })),
    });
  }
  return results;
}
function required(facts, id) {
  const fact = facts.find((f) => f.id === String(id));
  if (!fact)
    throw Object.assign(Error("Знание не найдено"), { statusCode: 404 });
  return fact;
}
export function chooseFact(facts, id, now) {
  const selected = required(facts, id);
  if (["merged", "rejected"].includes(selected.status))
    throw invalid("Эту карточку нельзя сделать актуальной");
  const peers = facts.filter(
    (f) =>
      f.id !== selected.id &&
      slot(f) === slot(selected) &&
      ["active", "candidate"].includes(f.status),
  );
  for (const fact of peers) {
    fact.status = "superseded";
    fact.superseded_by = selected.id;
    fact.updated_at = now;
    fact.events.push({ type: "superseded", target: selected.id, at: now });
  }
  selected.status = "active";
  selected.exclusive = true;
  selected.superseded_by = null;
  selected.updated_at = now;
  selected.events.push({
    type: "chosen",
    previous: peers.map((f) => f.id),
    at: now,
  });
  return selected;
}
export function mergeFacts(facts, targetId, duplicateId, now) {
  const target = required(facts, targetId),
    duplicate = required(facts, duplicateId);
  if (
    target === duplicate ||
    slot(target) !== slot(duplicate) ||
    [target, duplicate].some((f) => !["active", "candidate"].includes(f.status))
  )
    throw invalid(
      "Для объединения выберите актуальные карточки или кандидаты одной сущности и отношения. Историческую версию сначала сделайте актуальной.",
    );
  addSources(target, duplicate.sources);
  if (target.status === "candidate" && duplicate.status === "active")
    target.status = "active";
  if (target.sources.some((s) => s.kind === "user-confirmed"))
    target.source = "user-confirmed";
  target.topics = uniqueTopics([...target.topics, ...duplicate.topics]);
  target.aliases = [
    ...new Set([...target.aliases, identity(duplicate), ...duplicate.aliases]),
  ];
  target.updated_at = now;
  target.events.push({
    type: "merged",
    duplicate: duplicate.id,
    object: duplicate.object,
    at: now,
  });
  duplicate.status = "merged";
  duplicate.merged_into = target.id;
  duplicate.superseded_by = target.id;
  duplicate.updated_at = now;
  return target;
}
function similarity(a, b) {
  const words = (text) => new Set(key(text).split(" ").filter(Boolean));
  const x = words(a),
    y = words(b),
    union = new Set([...x, ...y]);
  return union.size ? [...x].filter((w) => y.has(w)).length / union.size : 0;
}
export function factDetail(facts, id) {
  const fact = required(facts, id),
    peers = facts.filter((f) => f.id !== fact.id && slot(f) === slot(fact));
  const entities = new Set([key(fact.subject), key(fact.object)]);
  const related = facts
    .filter((f) => f.id !== fact.id && f.status === "active")
    .map((f) => {
      const sharedEntity = [f.subject, f.object].find((v) =>
        entities.has(key(v)),
      );
      const sharedTopic = f.topics.find(
        (t) => t !== "Без темы" && fact.topics.some((v) => key(v) === key(t)),
      );
      return {
        ...f,
        relation: sharedEntity
          ? "Общая сущность: " + sharedEntity
          : sharedTopic
            ? "Общая тема: " + sharedTopic
            : "",
      };
    })
    .filter((f) => f.relation)
    .slice(0, 30);
  return {
    ...fact,
    history: peers
      .filter(
        (f) =>
          f.status === "superseded" ||
          f.status === "merged" ||
          f.superseded_by === fact.id,
      )
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    conflicts: peers.filter(
      (f) =>
        ["candidate", "active"].includes(f.status) &&
        (fact.exclusive || f.exclusive) &&
        identity(f) !== identity(fact),
    ),
    duplicates: peers.filter(
      (f) =>
        ["active", "candidate"].includes(f.status) &&
        similarity(f.object, fact.object) >= 0.65,
    ),
    related,
  };
}
export function listFacts(
  facts,
  {
    q = "",
    topic = "",
    kind = "",
    status = "active",
    offset = 0,
    limit = 30,
  } = {},
  maximum = 100,
) {
  const statuses = ["active", "candidate", "superseded", "all"];
  if (!statuses.includes(status) || (kind && !kinds.includes(kind)))
    throw invalid("Некорректный фильтр знаний");
  const query = key(q).slice(0, 200),
    topicKey = key(topic);
  const visible = facts.filter(
    (f) => !["merged", "rejected"].includes(f.status),
  );
  const filtered = visible
    .filter(
      (f) =>
        (status === "all" || f.status === status) &&
        (!kind || f.kind === kind) &&
        (!topicKey || f.topics.some((t) => key(t) === topicKey)) &&
        (!query ||
          key(
            [f.subject, f.predicate, f.object, ...f.topics].join(" "),
          ).includes(query)),
    )
    .sort(
      (a, b) =>
        String(b.updated_at).localeCompare(String(a.updated_at)) ||
        Number(b.id) - Number(a.id),
    );
  const skip = Math.max(0, Math.min(1000000, Math.floor(Number(offset) || 0))),
    size = Math.max(1, Math.min(maximum, Math.floor(Number(limit) || 30)));
  return {
    facts: filtered.slice(skip, skip + size),
    total: filtered.length,
    offset: skip,
    limit: size,
    topics: [...new Set(visible.flatMap((f) => f.topics))].sort((a, b) =>
      a.localeCompare(b, "ru"),
    ),
    counts: {
      active: visible.filter((f) => f.status === "active").length,
      candidate: visible.filter((f) => f.status === "candidate").length,
      superseded: visible.filter((f) => f.status === "superseded").length,
    },
  };
}
export function graphPage(facts, options = {}) {
  const page = listFacts(
    facts,
    {
      ...options,
      status: "active",
      limit: options.limit || 100,
    },
    300,
  );
  const nodes = new Map(),
    edges = [];
  for (const f of page.facts) {
    for (const label of [f.subject, f.object])
      if (!nodes.has(key(label)))
        nodes.set(key(label), {
          id: key(label),
          label,
          category: f.kind,
          topics: f.topics,
        });
    edges.push({
      id: f.id,
      source: key(f.subject),
      target: key(f.object),
      label: f.predicate,
      sourceType: f.source,
      createdAt: f.created_at,
      topic: f.topic,
    });
  }
  return {
    nodes: [...nodes.values()],
    edges,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
  };
}

// Forgetting has to be real: the card goes, the excerpts of a deleted message
// go with it, and nothing is left pointing at what no longer exists.
export function forgetFacts(facts, {ids = [], messages = []} = {}) {
  const wanted = new Set(ids.map(String).filter(Boolean));
  const fromMessages = new Set(messages.map(String).filter(Boolean));
  const doomed = new Set();
  for (const fact of facts) {
    const id = String(fact.id);
    if (wanted.has(id)) doomed.add(id);
    else if (fromMessages.size && fromMessages.has(String(fact.source_message_id ?? "")))
      doomed.add(id);
  }
  for (let i = facts.length - 1; i >= 0; i--)
    if (doomed.has(String(facts[i].id))) facts.splice(i, 1);
  for (const fact of facts) {
    if (doomed.has(String(fact.superseded_by))) {
      fact.superseded_by = null;
      if (fact.status === "superseded") fact.status = "active";
    }
    if (doomed.has(String(fact.merged_into))) fact.merged_into = null;
    if (fromMessages.size && Array.isArray(fact.sources)) {
      const kept = fact.sources.filter(
        (source) => !fromMessages.has(String(source?.messageId ?? "")),
      );
      if (kept.length !== fact.sources.length) fact.sources = kept;
    }
    if (fromMessages.has(String(fact.source_message_id ?? "")))
      fact.source_message_id = null;
  }
  return {removed: [...doomed]};
}
