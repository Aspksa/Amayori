import { knowledge } from "../core/knowledge-repository.mjs";
const count = await knowledge.importLocal();
console.log(
  "Перенос знаний в PostgreSQL завершён:",
  count,
  "карточек. Исходный knowledge.json сохранён.",
);
