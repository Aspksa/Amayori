import {recall} from './store.mjs';
import {searchMemory} from './postgres.mjs';
import {knowledge} from './knowledge-repository.mjs';
import {cloudEmbedding} from './cloud-embedding.mjs';

export async function collectChatMemory({text, config, databaseEnabled, embeddingModel}, dependencies = {}) {
  const lexicalRecall = dependencies.recall || recall;
  const factsSearch = dependencies.findFacts || ((q,limit)=>knowledge.find(q,limit));
  const vectorSearch = dependencies.searchMemory || searchMemory;
  const embed = dependencies.cloudEmbedding || cloudEmbedding;
  const warnings = [];
  const optional = async (name, fn, fallback) => {
    try { return await fn(); } catch { warnings.push(name); return fallback; }
  };
  const terms = [...new Set(text.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]{4,}/gu) || [])].slice(0, 6);
  const [lexical, semantic, batches] = await Promise.all([
    lexicalRecall(text),
    databaseEnabled && embeddingModel
      ? optional('pgvector', async () => vectorSearch(await embed(config, text, embeddingModel), 6), []) : [],
    Promise.all(terms.map(term => optional('facts', () => factsSearch(term, 12), []))),
  ]);
  const unique = new Map();
  for (const batch of batches) for (const fact of batch) unique.set(String(fact.id), fact);
  const score = fact => terms.reduce((n, term) => n + ([fact.subject, fact.predicate, fact.object]
    .some(value => String(value).toLocaleLowerCase('ru').includes(term)) ? 1 : 0), 0);
  const facts = [], factLines = [];
  let factLength = 0;
  for (const fact of [...unique.values()].sort((a, b) => score(b) - score(a)).slice(0, 12)) {
    const line = `${fact.subject} — ${fact.predicate} — ${fact.object}`;
    if (factLength + line.length + 1 > 1200) break;
    facts.push(fact); factLines.push(line); factLength += line.length + 1;
  }
  const semanticTexts = (Array.isArray(semantic) ? semantic : [])
    .filter(row => typeof row.content === 'string' && row.distance !== null
      && Number.isFinite(Number(row.distance)) && Number(row.distance) <= .5)
    .map(row => row.content).slice(0, 4);
  const seen = new Set(), lines = [], sources = {lexical: 0, semantic: 0};
  let length = 0;
  for (const [source, values] of [['semantic', semanticTexts], ['lexical', lexical]]) {
    for (const value of values) {
      const excerpt = String(value).trim().slice(0, 500), key = excerpt.toLocaleLowerCase('ru');
      if (!excerpt || seen.has(key) || length + excerpt.length + 1 > 3000) continue;
      seen.add(key); lines.push(excerpt); length += excerpt.length + 1; sources[source]++;
    }
  }
  return {context: lines.join('\n'), factContext: factLines.join('\n'), facts, sources, warnings: [...new Set(warnings)]};
}
