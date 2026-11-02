// Visual tour of the Amayori interface: one screenshot per screen.
// Runs the real server from an isolated copy — no user archive, no saved key,
// no database. Only /api/** answers are replaced with demo content, so no
// Cloud.ru request is ever sent and no quota is spent.
// Usage: npm run tour [output directory]
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// .runtime is ignored by git: screenshots are a local artefact, not source.
const out = path.resolve(process.argv[2] || path.join(root, ".runtime", "interface"));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "amayori-tour-"));
await fs.mkdir(out, { recursive: true });
let browser, server;

const now = Date.now();
const at = (min) => new Date(now - min * 60000).toISOString();
const messages = [
  { role: "user", content: "Привет! Запомни: мой проект называется Амаёри, и я пишу его на Node.js без Docker.", at: at(180) },
  { role: "assistant", content: "Запомнил. Амаёри — проект на **Node.js**, без Docker. Буду учитывать это в дальнейших ответах.", at: at(179) },
  { role: "user", content: "Как мне проверить, что сервер отвечает?", at: at(42) },
  { role: "assistant", content: "Проверь служебный маршрут — он отдаёт версию и имя приложения:\n\n```bash\ncurl http://127.0.0.1:57474/api/health\n```\n\nЕсли вернулся JSON с `ok: true`, сервер поднялся. Запуск при этом остаётся локальным: наружу порт не открывается.", at: at(41) },
  { role: "user", content: "Напомни, какую базу я выбрал для долговременной памяти?", at: at(6) },
  { role: "assistant", content: "Ты выбрал PostgreSQL с расширением `pgvector`: канонический архив диалогов и векторный поиск размерности 384. Локальный архив остаётся резервным режимом, если база не настроена.", at: at(5) },
];
const facts = [
  { id: 41, subject: "Амаёри", predicate: "написан на", object: "Node.js", source: "user-confirmed", confidence: 1, created_at: at(180) },
  { id: 38, subject: "Амаёри", predicate: "база памяти", object: "PostgreSQL с pgvector", source: "user-confirmed", confidence: 1, created_at: at(170) },
  { id: 33, subject: "Голем", predicate: "показывает", object: "карту семантической памяти", source: "cloudru-extracted", confidence: 0.9, created_at: at(140) },
  { id: 27, subject: "Амаёри", predicate: "не использует", object: "Docker", source: "cloudru-extracted", confidence: 0.8, created_at: at(120) },
];
const graph = {
  nodes: [
    { id: "Амаёри", label: "Амаёри" }, { id: "Node.js", label: "Node.js" },
    { id: "PostgreSQL с pgvector", label: "PostgreSQL с pgvector" }, { id: "Голем", label: "Голем" },
    { id: "карту семантической памяти", label: "карту семантической памяти" }, { id: "Docker", label: "Docker" },
    { id: "Cloud.ru", label: "Cloud.ru" }, { id: "память", label: "память" },
  ],
  edges: [
    { id: "41", source: "Амаёри", target: "Node.js", label: "написан на" },
    { id: "38", source: "Амаёри", target: "PostgreSQL с pgvector", label: "база памяти" },
    { id: "33", source: "Голем", target: "карту семантической памяти", label: "показывает" },
    { id: "27", source: "Амаёри", target: "Docker", label: "не использует" },
    { id: "25", source: "Амаёри", target: "Cloud.ru", label: "отвечает через" },
    { id: "21", source: "Голем", target: "память", label: "читает" },
    { id: "19", source: "PostgreSQL с pgvector", target: "память", label: "хранит" },
  ],
};
const api = {
  "/api/health": { ok: true, name: "Amayori", version: "0.6.3" },
  "/api/settings": { model: "GigaChat/Qwen2.5-72B-Instruct", endpoint: "https://foundation-models.api.cloud.ru/v1/chat/completions", hasKey: true },
  "/api/models": { models: [
    { id: "GigaChat/Qwen2.5-72B-Instruct", name: "Qwen2.5 72B Instruct", type: "llm" },
    { id: "RefalMachine/RuadaptQwen2.5-32B", name: "RuadaptQwen2.5 32B", type: "llm" },
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", type: "llm" },
  ] },
  "/api/memory/status": { messages: 1248, mode: "postgresql" },
  "/api/golem/embedding-status": { running: false, lastError: null, configured: true, total: 1248, indexed: 1180 },
  "/api/database/status": { enabled: true, connected: true, vectorEnabled: true },
  "/api/chats": { messages },
  "/api/knowledge/facts": { facts },
  "/api/knowledge/related": { facts: [facts[1], facts[3]] },
  "/api/knowledge/graph": graph,
  "/api/graph": graph,
  "/api/golem/knowledge": { ...graph, total: 7, offset: 0, limit: 300, source: "postgresql" },
  "/api/golem/settings": { defaultView: "original", autoRotate: true, nodeSize: 3 },
  "/api/golem/build-status": { state: "ready", nodes: 1248, updatedAt: at(12), error: null, running: false },
  "/api/golem/immunity": {
    duplicates: [{ subject: "Амаёри", predicate: "написан на", object: "Node.js", copies: 2 }],
    conflicts: [{ subject: "Амаёри", predicate: "версия", variants: 3 }],
    unverified: [facts[2], facts[3]],
  },
  "/api/knowledge/conflicts": { conflicts: [
    { id: 18, subject: "Амаёри", predicate: "версия", previous: "0.6.1", current: "0.6.3", replacement_id: 44 },
    { id: 12, subject: "Голем", predicate: "отрисовка", previous: "Canvas", current: "Three.js", replacement_id: 31 },
  ] },
  "/api/golem/bridges": { suggestions: [
    { first_id: 41, second_id: 38, first_subject: "Амаёри", second_subject: "Голем", shared_entity: "память" },
  ] },
  "/api/golem/traces": { traces: [
    { id: 90, question: "Напомни, какую базу я выбрал для долговременной памяти?", answer_excerpt: "PostgreSQL с pgvector…", fact_ids: ["38", "41"], created_at: at(5) },
    { id: 88, question: "Как мне проверить, что сервер отвечает?", answer_excerpt: "Проверь служебный маршрут…", fact_ids: ["41"], created_at: at(41) },
  ] },
  "/api/golem/live": { traces: [{ id: 90, fact_ids: ["38", "41"] }] },
};

// The Golem is built for a large memory: eight nodes show neither clusters nor
// sizing, so its page gets a denser generated graph than the readable demo above.
const themes = [
  ["Память", ["архив", "PostgreSQL", "pgvector", "эмбеддинги", "индексация", "миграция", "снимок", "вектор 384"]],
  ["Голем", ["карта", "кластеры", "узлы", "связи", "Three.js", "резервная карта", "след ответа", "легенда"]],
  ["Cloud.ru", ["модель", "ключ", "лимиты", "эндпоинт", "ответ", "проверка связи", "список моделей"]],
  ["Интерфейс", ["диалог", "аватар", "разделы", "настройки", "плотность", "анимации", "поиск"]],
  ["Запуск", ["Amayori.bat", "Node.js", "зависимости", "логи", "порт", "браузер"]],
  ["Знания", ["факты", "субъект", "предикат", "объект", "версии", "конфликты", "источники"]],
  ["Проверки", ["тесты", "CI", "Windows", "Chromium", "синтаксис"]],
];
const denseNodes = [], denseEdges = [];
let edgeId = 1000;
themes.forEach(([hub, leaves], theme) => {
  denseNodes.push({id: hub, label: hub});
  leaves.forEach((leaf, index) => {
    const name = leaf + " · " + hub;
    denseNodes.push({id: name, label: leaf});
    denseEdges.push({
      id: String(edgeId++), source: hub, target: name, label: "включает",
      sourceType: index % 3 === 0 ? "user-confirmed" : "cloudru-extracted",
    });
    if (index > 1)
      denseEdges.push({
        id: String(edgeId++), source: name, target: leaves[index - 2] + " · " + hub,
        label: "связано", sourceType: "cloudru-extracted",
      });
  });
  if (theme > 0)
    denseEdges.push({
      id: String(edgeId++), source: hub, target: themes[theme - 1][0],
      label: "граничит", sourceType: "user-confirmed",
    });
});
const denseTrace = denseEdges.slice(4, 16).map((edge) => edge.id);

try {
  for (const name of ["public", "core", "server.mjs", "package.json"])
    await fs.cp(path.join(root, name), path.join(temp, name), { recursive: true });
  await fs.symlink(path.join(root, "node_modules"), path.join(temp, "node_modules"), "dir");
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const base = "http://127.0.0.1:" + port;
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: temp,
    env: { ...process.env, PORT: String(port), AMAYORI_GOLEM_AUTO_BUILD: "0", AMAYORI_DATABASE_URL: "", AMAYORI_EMBEDDING_MODEL: "", AMAYORI_GRAPHITI_BRIDGE_URL: "" },
    stdio: "ignore",
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + "/api/health")).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  if (!ready) throw Error("server did not start");

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.AMAYORI_UI_BROWSER_EXECUTABLE || undefined,
    args: process.env.AMAYORI_UI_BROWSER_ARGS
      ? JSON.parse(process.env.AMAYORI_UI_BROWSER_ARGS)
      : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2, timezoneId: "Asia/Vladivostok" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const mock = async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/chat") return route.fulfill({ json: { answer: "Демонстрационный ответ.", model: "demo", traceId: "90", usedFactIds: ["38"], memorySources: { lexical: 1, semantic: 2 } } });
    const data = api[pathname];
    return data ? route.fulfill({ json: data }) : route.continue();
  };
  await page.route("**/api/**", mock);

  const shots = [
    ["#chat", "1-dialog.png", "Диалог"],
    ["#memory/archive", "2-memory-archive.png", "Память · Архив"],
    ["#memory/facts", "3-memory-facts.png", "Память · Знания"],
    ["#memory/quality", "4-memory-quality.png", "Память · Проверка"],
    ["#graph", "5-graph.png", "Карта знаний"],
    ["#settings/connection", "6-settings-connection.png", "Настройки · Подключение"],
    ["#settings/appearance", "7-settings-appearance.png", "Настройки · Вид"],
    ["#settings/brain", "8-settings-brain.png", "Настройки · Мозг"],
  ];
  await page.goto(base + "/#chat");
  await page.waitForFunction(() => document.querySelectorAll(".message").length >= 6, { timeout: 15000 });
  for (const [hash, file, label] of shots) {
    await page.goto(base + "/" + hash);
    await delay(900);
    await page.screenshot({ path: path.join(out, file) });
    console.log("снято:", label);
  }

  const golem = await context.newPage();
  golem.on("pageerror", (error) => errors.push(error.message));
  await golem.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/golem/knowledge")
      return route.fulfill({
        json: {nodes: denseNodes, edges: denseEdges, total: denseNodes.length, offset: 0, limit: 300, source: "postgresql"},
      });
    if (pathname === "/api/golem/live")
      return route.fulfill({json: {traces: [{id: 777, fact_ids: denseTrace}]}});
    return mock(route);
  });
  await golem.goto(base + "/golem");
  await delay(6000);
  await golem.screenshot({ path: path.join(out, "9-golem.png") });
  const mode = await golem.evaluate(() => ({
    webgl: document.getElementById("brain").classList.contains("golem-ready"),
    notice: document.getElementById("notice").textContent,
  }));
  console.log("снято: Голем /golem — 3D активен:", mode.webgl, mode.notice ? "| " + mode.notice : "");
  console.log(errors.length ? "ОШИБКИ СТРАНИЦ: " + errors.join(" | ") : "ошибок страниц нет");
} finally {
  await browser?.close();
  server?.kill();
  await fs.rm(temp, { recursive: true, force: true });
}
console.log("Снимки интерфейса:", out);
