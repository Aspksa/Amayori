// Pure, bounded knowledge network projection. No model calls or database writes.
const clean = value => String(value ?? '').trim();
const unique = values => [...new Set(values.map(clean).filter(Boolean))];
export function buildGolemNetwork(facts, {limit = 10000} = {}) {
  const cap = Math.max(1, Math.min(10000, Number(limit) || 10000));
  const nodes = new Map(), edges = [], alerts = [];
  const add = (id, label, type, extra = {}) => {
    if (!nodes.has(id)) nodes.set(id, {id, label, type, ...extra});
  };
  for (const fact of facts.slice(0, cap)) {
    const id = clean(fact.id);
    if (!id) continue;
    const fid = 'fact:' + id;
    const status = clean(fact.status) || 'active';
    const topics = unique(Array.isArray(fact.topics) ? fact.topics : [fact.topic]);
    const label = [fact.subject, fact.predicate, fact.object].map(clean).filter(Boolean).join(' — ');
    add(fid, label || 'Факт ' + id, 'fact', {status, createdAt:fact.created_at || null});
    for (const [kind, value] of [['subject',fact.subject], ['object',fact.object]]) {
      const name = clean(value);
      if (!name) continue;
      const eid = 'entity:' + name.toLocaleLowerCase('ru');
      add(eid, name, 'entity');
      edges.push({source:kind === 'subject' ? eid : fid, target:kind === 'subject' ? fid : eid, type:kind === 'subject' ? 'subject' : clean(fact.predicate) || 'object', factId:id});
    }
    for (const topic of topics) {
      const tid = 'topic:' + topic.toLocaleLowerCase('ru');
      add(tid, topic, 'topic');
      edges.push({source:fid,target:tid,type:'topic',factId:id});
    }
    const sources = Array.isArray(fact.sources) ? fact.sources : [];
    for (const source of sources) {
      const mid = clean(source?.messageId);
      if (!mid) continue;
      const sid = 'message:' + mid;
      add(sid, 'Сообщение ' + mid, 'message');
      edges.push({source:fid,target:sid,type:'source',factId:id});
    }
    if (status === 'candidate') alerts.push({factId:id,type:'conflict',label:'Требует проверки'});
    if (status === 'superseded') alerts.push({factId:id,type:'outdated',label:'Заменённая версия'});
    if (status === 'active' && fact.source !== 'user-confirmed' && !sources.some(s => s?.excerpt || s?.messageId || s?.kind === 'user-confirmed'))
      alerts.push({factId:id,type:'missing-source',label:'Нет подтверждённого источника'});
  }
  return {nodes:[...nodes.values()],edges,alerts,stats:{facts:Math.min(facts.length,cap),totalFacts:facts.length,nodes:nodes.size,edges:edges.length,alerts:alerts.length,truncated:facts.length>cap}};
}
