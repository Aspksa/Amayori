// Runs against an isolated, empty project copy. Cloud requests are mocked.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  groupConversations,
  listConversations,
  conversationPage,
} from "../core/conversations.mjs";
import { buildTopicOverview } from "../core/topic-overview.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "amayori-interface-"));
let browser, server;
const checks = [];
function check(message) { checks.push(message); console.log("✓ " + message); }
async function browserContext(options) {
  const context = await browser.newContext(options);
  context.setDefaultTimeout(30000);
  return context;
}
try {
  for (const name of ["public", "core", "server.mjs", "package.json"])
    await fs.cp(path.join(root, name), path.join(temp, name), {
      recursive: true,
    });
  await fs.symlink(
    path.join(root, "node_modules"),
    path.join(temp, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = "http://127.0.0.1:" + port;
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: temp,
    env: {
      ...process.env,
      PORT: String(port),
      AMAYORI_GOLEM_AUTO_BUILD: "0",
      AMAYORI_DERIVED_REFRESH_MS: "0",
      AMAYORI_DATABASE_URL: "",
      AMAYORI_GRAPHITI_BRIDGE_URL: "",
      AMAYORI_EMBEDDING_MODEL: "",
    },
    stdio: "ignore",
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, "isolated server starts");
  const args = process.env.AMAYORI_UI_BROWSER_ARGS
    ? JSON.parse(process.env.AMAYORI_UI_BROWSER_ARGS)
    : [];
  browser = await chromium.launch({
    headless: true,
    args,
    executablePath: process.env.AMAYORI_UI_BROWSER_EXECUTABLE || undefined,
  });
  const context = await browserContext({
    viewport: { width: 1440, height: 950 },
    timezoneId: "Asia/Vladivostok",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForSelector(".chat-empty");
  assert.equal(await page.locator("#floating-chat").count(), 1);
  assert.equal(await page.locator("#chat-avatar").isVisible(), false);
  assert.equal(await page.locator("#chat-connection-hint").isVisible(), true);
  assert.equal(await page.locator("#golem-webgl").count(), 0);
  check(
    "Empty local mode has one chat, a connection hint and no embedded Golem",
  );

  let messages = [
    {
      id: "m1",
      role: "user",
      content: "Помоги продумать сад.",
      at: "2026-11-02T01:00:00Z",
    },
    {
      id: "m2",
      role: "assistant",
      content:
        'Начнём с **плана** и дорожек.\n\nПример: `garden`.\n```js\nconst garden = "тихое место";\n```',
      at: "2026-11-02T01:00:01Z",
    },
    {
      id: "m3",
      role: "user",
      content: '<img src=x onerror="window.injected=true">',
      at: "2026-11-02T02:00:00Z",
    },
    {
      id: "m4",
      role: "assistant",
      content: "Это текст, который должен остаться текстом.",
      at: "2026-11-02T02:00:01Z",
    },
  ];
  const graph = {
    nodes: [
      { id: "сад", label: "сад", count: 4 },
      { id: "дорожки", label: "дорожки", count: 2 },
      { id: "деревья", label: "деревья", count: 3 },
    ],
    edges: [
      { id: "сад|дорожки", source: "сад", target: "дорожки" },
      { id: "сад|деревья", source: "сад", target: "деревья" },
    ],
  };
  const facts = [
    {
      id: 1,
      subject: "Сад",
      predicate: "стиль",
      object: "Природный",
      source: "user-confirmed",
      topic: "Сад",
      topics: ["Сад"],
      status: "active",
      sources: [],
    },
    {
      id: 2,
      subject: "Сад",
      predicate: "зона",
      object: "Отдых",
      source: "cloudru-extracted",
      topic: "Сад",
      topics: ["Сад"],
      status: "active",
      sources: [],
    },
  ];
  let settings = { model: "test-model", hasKey: true },
    brain = { defaultView: "original", autoRotate: true, nodeSize: 2 },
    calls = 0,
    semanticScenario = false,
    semanticMode = "matches";
  let conversations = [
    {
      id: "c1",
      title: "Общий диалог",
      messages: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const deleted = [];
  const mockRoute = async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname,
      method = route.request().method();
    let data;
    if (p === "/api/settings") {
      if (method === "POST") {
        const body = route.request().postDataJSON();
        settings = {
          model: body.model,
          hasKey: settings.hasKey || !!body.apiKey,
        };
        data = { ok: true };
      } else data = settings;
    } else if (p === "/api/models")
      data = {
        models: [
          { id: "test-model", name: "Тестовая модель", type: "llm" },
          { id: "second-model", name: "Другая модель", type: "llm" },
          { id: "second-model", name: "Другая модель", type: "llm" },
        ],
      };
    else if (p === "/api/chats") {
      if (method === "DELETE") {
        const id = url.searchParams.get("id");
        deleted.push(id);
        const before = messages.length;
        messages = messages.filter((message) => String(message.id) !== String(id));
        data = { ok: true, messages: before - messages.length, facts: 1 };
      } else {
        const query = (url.searchParams.get("q") || "").toLocaleLowerCase("ru");
        const scope = url.searchParams.get("conversation");
        let found = messages.filter(
          (message) =>
            (!query || message.content.toLocaleLowerCase("ru").includes(query)) &&
            (!scope || String(message.conversation || conversations[0].id) === String(scope)),
        );
        const limit = Math.max(1, Number(url.searchParams.get("limit")) || 100);
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        const end = Math.max(0, found.length - offset);
        data = {
          messages: found.slice(Math.max(0, end - limit), end),
          total: found.length,
          limit,
          offset,
        };
      }
    } else if (p === "/api/conversations") {
      if (method === "POST") {
        const made = {
          id: "c" + (conversations.length + 1),
          title: "Новый диалог",
          messages: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        conversations = [made, ...conversations];
        data = made;
      } else data = { conversations };
    }
    else if (p === "/api/memory/status")
      data = {
        messages: messages.length,
        mode: semanticScenario ? "postgresql" : "local",
      };
    else if (p === "/api/database/status")
      data = { enabled: semanticScenario, connected: semanticScenario };
    else if (p === "/api/golem/embedding-status")
      data = {
        configured: semanticScenario,
        total: messages.length,
        indexed: semanticScenario ? messages.length : 0,
      };
    else if (p === "/api/graph")
      data = semanticScenario ? { nodes: [], edges: [] } : graph;
    else if (p === "/api/golem/knowledge")
      data = {
        nodes: [],
        edges: [],
        total: 0,
        source: semanticScenario ? "postgresql" : "postgresql-unavailable",
      };
    else if (p === "/api/knowledge/folders")
      data = buildTopicOverview(facts, []);
    else if (p === "/api/conversations/grouped")
      data = listConversations(
        groupConversations(messages),
        Object.fromEntries(url.searchParams),
      );
    else if (p === "/api/conversations/item")
      data = conversationPage(
        groupConversations(messages),
        url.searchParams.get("id"),
        Object.fromEntries(url.searchParams),
      );
    else if (p === "/api/knowledge/facts")
      data = { facts, topics: ["Сад"], total: facts.length };
    else if (p === "/api/knowledge/card")
      data = {
        ...facts.find((f) => String(f.id) === url.searchParams.get("id")),
        sources: [],
        history: [],
        conflicts: [],
        duplicates: [],
        related: [facts[1]],
      };
    else if (p === "/api/knowledge/extraction")
      data = {
        enabled: false,
        queued: 0,
        running: false,
        failed: 0,
        completed: 0,
        lastError: "",
      };
    else if (p === "/api/knowledge/related") data = { facts: [facts[1]] };
    else if (p === "/api/golem/immunity")
      data = { duplicates: [], conflicts: [], unverified: [facts[1]] };
    else if (p === "/api/knowledge/conflicts")
      data = {
        conflicts: [
          {
            subject: "Сад",
            predicate: "стиль",
            previous: "Регулярный",
            current: "Природный",
          },
        ],
      };
    else if (p === "/api/golem/bridges") data = { suggestions: [] };
    else if (p === "/api/golem/traces")
      data = {
        traces: [{ question: "Как устроен сад?", fact_ids: ["1", "2"] }],
      };
    else if (p === "/api/golem/build-status")
      data = { state: "idle", nodes: 0 };
    else if (p === "/api/golem/settings") {
      if (method === "POST") {
        brain = route.request().postDataJSON();
        data = { ok: true };
      } else data = brain;
    } else if (p === "/api/test-connection") data = { ok: true };
    else if (p === "/api/chat") {
      calls++;
      const body = route.request().postDataJSON();
      await delay(150);
      messages.push(
        {
          id: "m" + (messages.length + 1),
          role: "user",
          content: body.message,
          at: new Date().toISOString(),
        },
        {
          id: "m" + (messages.length + 2),
          role: "assistant",
          content: "Готово. **План** сохранён в разговоре.",
          at: new Date().toISOString(),
        },
      );
      data = {
        answer: messages.at(-1).content,
        model: body.model || settings.model,
        usedFactIds: [],
      };
    } else if (p === "/api/golem/index-batch") data = { configured: false };
    else if (p === "/api/golem/similar") {
      await delay(150);
      if (semanticScenario && semanticMode === "error")
        return route.fulfill({
          status: 503,
          json: { error: "Поиск временно недоступен" },
        });
      data = {
        results:
          semanticScenario && semanticMode === "empty"
            ? []
            : [{ content: "План сада и дорожек", distance: 0.1 }],
      };
    } else
      return route.fulfill({
        status: 404,
        json: { error: "Unexpected mock endpoint: " + p },
      });
    await route.fulfill({ json: data });
  };
  await page.route("**/api/**", mockRoute);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".message").length === 4,
  );
  assert.equal(
    await page.locator("#chat-model option").count(),
    2,
    "default and duplicate models occur only once",
  );
  assert.equal(await page.locator(".message-body img").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator(".code-block").count(), 1);
  assert.equal(await page.locator(".message-body strong").count(), 1);
  check(
    "Model choices are unique; message HTML is escaped; code and emphasis render safely",
  );

  await page.locator("#chat-input").fill("Новый шаг плана");
  await page.evaluate(() => {
    const form = document.getElementById("chat-form");
    form.requestSubmit();
    form.requestSubmit();
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".message").length === 6 &&
      !document.querySelector(".message.pending"),
  );
  assert.equal(calls, 1, "repeated submit sends only one request");
  assert.equal(
    await page
      .locator(".message.user")
      .filter({ hasText: "Новый шаг плана" })
      .count(),
    1,
  );
  await page.locator("#chat-find").click();
  await page.locator("#chat-search").fill("дорожек");
  assert.equal(await page.locator(".message:visible").count(), 1);
  assert.ok((await page.locator(".message mark").count()) > 0);
  await page.locator("#chat-search-close").click();
  await page
    .locator("#chat-input")
    .fill("Черновик\nВторая строка\nТретья строка\nЧетвёртая строка");
  const draft = await page.locator("#chat-input").inputValue();
  assert.ok(
    (await page
      .locator("#chat-input")
      .evaluate((el) => el.getBoundingClientRect().height)) > 65,
  );
  check(
    "Double submit is blocked, search highlights matches, composer grows with the draft",
  );

  await page.locator("a.nav-link[data-page=memory]").click();
  await page.waitForURL("**/#memory");
  await page.locator("#chat-avatar").waitFor({ state: "visible" });
  assert.equal(await page.locator("#chat-avatar").isVisible(), true);
  await page.locator("#chat-avatar").click();
  assert.equal(await page.locator("#floating-chat").count(), 1);
  assert.equal(await page.locator("#floating-chat.floating").isVisible(), true);
  assert.equal(await page.locator("#chat-input").inputValue(), draft);
  await page.locator("#chat-expand").click();
  assert.equal(await page.locator("#floating-chat.expanded").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#floating-chat").isVisible(), false);
  await page.locator("#archive-search").fill("сад");
  await page.locator("#archive-list mark").first().waitFor();
  await page.locator("#archive-search").fill("");
  await page.waitForFunction(
    () => document.querySelectorAll("#archive-list mark").length === 0,
  );
  // Conversations, paging and forgetting: the archive used to stop at a hundred
  // messages and nothing could ever be deleted.
  const archiveText = await page
    .locator("#archive-list")
    .evaluate((list) => list.textContent);
  assert.doesNotMatch(
    archiveText,
    /```|\*\*/,
    "archive previews show text, not Markdown markers",
  );
  await page.locator("#archive-list .archive-item").first().click();
  await page
    .locator("#topic-conversation-messages .conversation-message")
    .first()
    .waitFor();
  assert.equal(await page.locator("#topic-window").isVisible(), true);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.page),
    "memory",
  );
  const beforeForget = await page.locator("#topic-conversation-messages .conversation-message").count();
  const forget = page.locator("#topic-conversation-messages .archive-forget").first();
  await forget.click();
  assert.equal(await forget.textContent(), "Удалить?");
  await forget.click();
  await page.waitForFunction(
    (count) => document.querySelectorAll("#topic-conversation-messages .conversation-message").length === count - 1,
    beforeForget,
  );
  assert.equal(deleted.length, 1, "удаление ушло на сервер");
  assert.ok(deleted[0] && deleted[0] !== "undefined", "сервер получил идентификатор сообщения");
  check("Архив ищет целиком; сообщение можно явно забыть внутри беседы");
  await page.locator("#topic-window-close").click();
  assert.equal(await page.locator("#chat-input").inputValue(), draft);
  check(
    "Avatar reuses the same conversation; draft survives navigation, floating mode and expansion",
  );

  await page.locator("a.nav-link[data-page=graph]").click();
  await page.waitForSelector('#graph-count:text("3 узлов")');
  await page.locator("#golem-search").fill("деревья");
  await page
    .locator("#graph-search-form")
    .evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() =>
    document.getElementById("graph-count").textContent.startsWith("2 узлов"),
  );
  await page.locator("#graph-reset").click();
  await page.waitForFunction(() =>
    document.getElementById("graph-count").textContent.startsWith("3 узлов"),
  );
  await page.locator("#knowledge-map").focus();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(
    await page.locator("#golem-selected").textContent(),
    "Выберите узел",
  );
  check(
    "Local knowledge graph supports search, reset and keyboard selection",
  );

  await page.locator("a.nav-link[data-page=memory]").click();
  await page.locator("#tab-facts").click();
  await page.locator(".topic-folder").first().click();
  await page.waitForSelector(".fact-card");
  await page.locator(".fact-card .fact-open").first().click();
  await page.waitForSelector(".fact-related");
  await page.locator("#topic-window-close").click();
  await page.locator("#tab-quality").click();
  await page.waitForSelector(".quality-card");
  assert.deepEqual(
    await page.locator(".quality-card>strong").allTextContents(),
    ["1", "0", "1"],
  );
  check(
    "Facts, related knowledge and quality reports display readable results",
  );

  await page.locator("a.nav-link[data-page=settings]").click();
  await page.locator("#api-key").fill("demo-test-key");
  await page.locator("#toggle-key").click();
  assert.equal(await page.locator("#api-key").getAttribute("type"), "text");
  await page.locator("#settings-form button[type=submit]").click();
  await page.waitForFunction(
    () => document.getElementById("api-key").value === "",
  );
  assert.equal(await page.locator("#api-key").getAttribute("type"), "password");
  await page.locator("#test-connection").click();
  await page.waitForFunction(
    () => document.getElementById("connection-badge").dataset.state === "ready",
  );
  await page.locator("#tab-brain").click();
  await page.locator("#golem-auto-rotate").uncheck();
  await page.locator("#golem-settings-size").focus();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.locator("#golem-settings-form button[type=submit]").click();
  await page.waitForFunction(
    () =>
      document.getElementById("golem-settings-status").textContent.length > 0,
  );
  assert.equal(brain.autoRotate, false);
  assert.equal(brain.nodeSize, 4);
  await page.locator("#tab-appearance").click();
  await page.locator("#interface-density").selectOption("compact");
  await page.locator("#menu-labels").check();
  await page.locator("#interface-motion").uncheck();
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.density === "compact",
  );
  assert.equal(
    await page.locator("html").getAttribute("data-menu-labels"),
    "true",
  );
  assert.equal(await page.locator("html").getAttribute("data-motion"), "false");
  check(
    "Connection and brain forms work; secrets clear after saving; appearance preferences persist",
  );

  // Capture the activity stream the Golem subscribes to, so the live channel is
  // verified end to end without needing a real Cloud.ru answer.
  await context.addInitScript(() => {
    globalThis.__streams = [];
    globalThis.EventSource = class extends EventTarget {
      constructor(url) {
        super();
        this.url = String(url);
        globalThis.__streams.push(this);
      }
      close() {}
    };
  });
  const popupPromise = context.waitForEvent("page");
  await page.locator('a[href="/golem"]').click();
  const popup = await popupPromise;
  popup.on("pageerror", (error) => errors.push(error.message));
  await popup.waitForFunction(
    () =>
      document.getElementById("brain").classList.contains("golem-ready") ||
      document
        .getElementById("notice")
        .textContent.includes("3D не загрузился"),
  );
  assert.equal(await popup.locator("button:visible").count(), 0);
  if (
    await popup
      .locator("#brain")
      .evaluate((el) => el.classList.contains("golem-ready"))
  ) {
    const canLose = await popup.evaluate(() => {
      globalThis.testLoss = document
        .getElementById("brain")
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context");
      if (testLoss) {
        testLoss.loseContext();
        return true;
      }
      return false;
    });
    if (canLose) {
      await popup.waitForFunction(
        () => !document.getElementById("fallback-brain").hidden,
      );
      await popup.evaluate(() => testLoss.restoreContext());
      await popup.waitForFunction(() =>
        document.getElementById("brain").classList.contains("golem-ready"),
      );
      const pixels = await popup.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("No rendered frame after recovery")),
              6000,
            );
            document.getElementById("brain").addEventListener(
              "golem-rendered",
              () => {
                clearTimeout(timer);
                const gl = document
                    .getElementById("brain")
                    .getContext("webgl2"),
                  array = new Uint8Array(
                    gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
                  );
                gl.readPixels(
                  0,
                  0,
                  gl.drawingBufferWidth,
                  gl.drawingBufferHeight,
                  gl.RGBA,
                  gl.UNSIGNED_BYTE,
                  array,
                );
                let n = 0;
                for (let i = 0; i < array.length; i += 4)
                  if (array[i] > 40 || array[i + 1] > 40 || array[i + 2] > 40)
                    n++;
                resolve(n);
              },
              { once: true },
            );
          }),
      );
      assert.ok(pixels > 100, "Golem draws nodes after context recovery");
    }
  } else assert.equal(await popup.locator("#fallback-brain").isVisible(), true);
  assert.match(
    await popup.evaluate(() => globalThis.__streams?.[0]?.url || ""),
    /\/api\/golem\/stream$/,
    "Golem subscribes to the live activity stream",
  );
  await popup.evaluate(() =>
    globalThis.__streams[0].dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "build", state: "building" }),
      }),
    ),
  );
  await popup.waitForFunction(() =>
    document.getElementById("notice").textContent.includes("Пересобираю"),
  );
  check("Голем подписан на поток активности и реагирует на события");
  // The sky used to have no controls at all: a star could only be found by chance.
  await popup.route("**/api/golem/knowledge*", (route) =>
    route.fulfill({
      json: {
        nodes: [
          { id: "Амаёри", label: "Амаёри" },
          { id: "Node.js", label: "Node.js" },
          { id: "память", label: "память" },
        ],
        edges: [
          { id: "1", source: "Амаёри", target: "Node.js", label: "написан на", sourceType: "user-confirmed", confidence: 1, createdAt: "2026-01-01T00:00:00Z" },
          { id: "2", source: "Амаёри", target: "память", label: "хранит", sourceType: "cloudru-extracted", confidence: 0.9, createdAt: "2026-02-01T00:00:00Z" },
        ],
        total: 3,
        source: "postgresql",
      },
    }),
  );
  await popup.reload();
  await popup.waitForFunction(
    () => !document.getElementById("legend").hidden &&
      document.querySelectorAll(".sky-label").length > 0,
  );
  await popup.keyboard.press("/");
  await popup.waitForSelector("#sky-search:not([hidden])");
  await popup.locator("#sky-query").fill("Амаёри");
  await popup.waitForFunction(
    () => /^1 \/ \d+$/.test(document.getElementById("sky-count").textContent || ""),
  );
  await popup.keyboard.press("Enter");
  await popup.waitForSelector("#detail:not([hidden])");
  assert.match(
    (await popup.locator("#detail-body h2").textContent()) || "",
    /Амаёри/,
    "поиск доводит до карточки звезды",
  );
  await popup.locator("#sky-query").press("Escape");
  await popup.waitForSelector("#sky-search", { state: "hidden" });
  await popup.locator(".legend-row").first().click();
  await popup.waitForSelector(".legend-row.isolated");
  await popup.locator(".legend-row.isolated").first().click();
  assert.equal(await popup.locator(".legend-row.isolated").count(), 0,
    "повторное нажатие снимает изоляцию созвездия");
  check("Небо ищется, подписывается, ходится клавишами и фильтруется по созвездию");
  await popup.close();
  check(
    "Golem opens separately without toolbar clutter and recovers from GPU context loss",
  );

  // Check every section and tab at phone, tablet and desktop sizes.
  const routes = [
    "chat",
    "memory/archive",
    "memory/facts",
    "memory/quality",
    "graph",
    "settings/connection",
    "settings/appearance",
    "settings/brain",
  ];
  for (const width of [320, 390, 768, 1366, 1440, 1920]) {
    await page.setViewportSize({
      width,
      height:
        width === 320 ? 640 : width === 1366 ? 768 : width < 600 ? 844 : 950,
    });
    for (const route of routes) {
      await page.evaluate((route) => {
        location.hash = "#" + route;
      }, route);
      await page.waitForFunction(
        (route) =>
          document.documentElement.dataset.page === route.split("/")[0],
        route,
      );
      if (route.includes("/"))
        await page.waitForFunction(
          (tab) =>
            document
              .getElementById("tab-" + tab)
              .getAttribute("aria-selected") === "true",
          route.split("/")[1],
        );
      await page.waitForTimeout(30);
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScroll: document.body.scrollTop,
        top: document.querySelector(".topbar").getBoundingClientRect().top,
        views: [
          ...document.querySelectorAll("#workspace > [data-view]"),
        ].filter((x) => !x.hidden).length,
      }));
      if (metrics.scrollWidth > metrics.width)
        console.log(
          "Overflow",
          route,
          width,
          await page.evaluate(() =>
            [...document.querySelectorAll("body *")]
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(
                ({ el, r }) =>
                  r.width &&
                  r.right > innerWidth + 0.5 &&
                  !el.closest("[hidden]"),
              )
              .slice(0, 15)
              .map(({ el, r }) => ({
                tag: el.tagName,
                id: el.id,
                class: el.className,
                right: r.right,
                width: r.width,
              })),
          ),
        );
      assert.equal(
        metrics.scrollWidth,
        metrics.width,
        route + " fits width " + width,
      );
      assert.equal(metrics.bodyScroll, 0, route + " has no whole-page scroll");
      assert.equal(metrics.top, 0, route + " keeps the header fixed");
      assert.equal(metrics.views, 1, "only one section is visible");
    }
  }
  check(
    "All 8 views/tabs fit 320, 390, 768, 1366, 1440 and 1920 px without whole-page scrolling",
  );
  await page.evaluate(() => {
    localStorage.removeItem("amayori-appearance");
    location.hash = "#chat";
  });
  await page.reload();
  await page.waitForSelector(".message");
  await page.locator("#chat-more").click();
  const download = page.waitForEvent("download");
  await page.locator("#chat-export").click();
  assert.match((await download).suggestedFilename(), /^Amayori-/);
  await page.locator("#chat-more").click();
  // Relative to whatever the archive holds now: an earlier check deletes one
  // message on purpose, and clearing the screen must still change nothing.
  const archivedBefore = messages.length;
  await page.locator("#chat-clear-view").click();
  assert.equal(await page.locator(".message").count(), 0);
  assert.equal(
    messages.length,
    archivedBefore,
    "clearing the screen does not delete the archive",
  );
  check(
    "Export downloads a file; clearing the screen preserves the archive",
  );
  const phoneContext = await browserContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "Asia/Vladivostok",
  });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.route("**/api/**", mockRoute);
  await phone.goto(base);
  // Counted from the archive, not hard-coded: an earlier check deletes one.
  await phone.waitForFunction(
    (count) => document.querySelectorAll(".message").length === count,
    messages.length,
  );
  assert.equal(
    await phone.evaluate(() => matchMedia("(pointer: coarse)").matches),
    true,
  );
  await phone.locator("#chat-input").fill("Мобильный черновик");
  await phone.keyboard.press("Enter");
  assert.equal(calls, 1, "mobile Enter inserts a newline instead of sending");
  assert.ok((await phone.locator("#chat-input").inputValue()).endsWith("\n"));
  const phoneBefore = messages.length;
  await phone.locator("#chat-send").tap();
  await phone.waitForFunction(
    (count) =>
      document.querySelectorAll(".message").length === count &&
      !document.querySelector(".message.pending"),
    phoneBefore + 2,
  );
  assert.equal(calls, 2);
  await phone.locator('a.nav-link[data-page="memory"]').tap();
  await phone.locator("#chat-avatar").waitFor({ state: "visible" });
  await phone.locator("#chat-avatar").tap();
  await phone.locator("#floating-chat.floating").waitFor({ state: "visible" });
  assert.equal(await phone.locator("#floating-chat").count(), 1);
  await phone.locator("#chat-expand").tap();
  const phoneBounds = await phone.locator("#floating-chat").boundingBox();
  assert.ok(
    phoneBounds.x >= 0 &&
      phoneBounds.y >= 0 &&
      phoneBounds.x + phoneBounds.width <= 390 &&
      phoneBounds.y + phoneBounds.height <= 844,
  );
  check(
    "Touch input preserves newlines; sending and avatar opening do not duplicate messages or dialogs",
  );
  await phone.locator('a.nav-link[data-page="graph"]').tap();
  await phone.waitForFunction(() =>
    document.getElementById("graph-count").textContent.startsWith("3 узлов"),
  );
  await phone.locator("#graph-zoom-in").tap();
  assert.match(
    await phone.locator("#knowledge-map").getAttribute("aria-label"),
    /120%/,
  );
  await phone.locator("#graph-zoom-out").tap();
  assert.match(
    await phone.locator("#knowledge-map").getAttribute("aria-label"),
    /100%/,
  );
  semanticScenario = true;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 950 });
    await page.goto(base + "/#graph");
    await page.reload();
    await page.locator(".graph-workspace.is-empty").waitFor();
    await page.locator("#golem-similar").waitFor({ state: "visible" });
    for (const [mode, expected] of [
      ["matches", "План сада и дорожек"],
      ["empty", "Похожих воспоминаний пока нет."],
      ["error", "Поиск временно недоступен"],
    ]) {
      semanticMode = mode;
      await page.locator("#golem-search").fill("сад");
      await page.locator("#golem-similar").click();
      const refreshed = page.waitForResponse((response) =>
        response.url().includes("/api/golem/knowledge"),
      );
      await page.evaluate(() =>
        document.dispatchEvent(new Event("amayori-chat-updated")),
      );
      await refreshed;
      await page.waitForFunction(
        (text) =>
          document
            .getElementById("golem-similar-results")
            .textContent.includes(text),
        expected,
      );
      assert.equal(await page.locator(".graph-inspector").isVisible(), true);
      assert.equal(await page.locator(".graph-workspace.is-empty").count(), 0);
      await page
        .locator("#golem-similar-results li")
        .first()
        .scrollIntoViewIfNeeded();
      assert.equal(
        await page.locator("#golem-similar-results li").first().isVisible(),
        true,
      );
      assert.equal(await page.locator("#graph-count").textContent(), "");
    }
  }
  check(
    "Semantic matches, no-match messages and errors stay visible on an empty graph, including refresh and mobile layout",
  );
  semanticScenario = false;
  const workContext = await browserContext({
    viewport: { width: 1440, height: 950 },
    timezoneId: "Asia/Vladivostok",
  });
  await workContext.route("**/api/**", mockRoute);
  const work = await workContext.newPage();
  work.on("pageerror", (error) => errors.push(error.message));
  await work.goto(base + "/#chat");
  await work.waitForFunction(
    (count) => document.querySelectorAll(".message").length === count,
    messages.length,
  );
  await work.evaluate(() => {
    globalThis.originalChat = document.getElementById("floating-chat");
  });
  await work.locator("#chat-input").fill("Черновик рабочего места");
  await work.locator("#workspace-toggle").click();
  await work.locator("#workspace.workspace-split").waitFor();
  assert.equal(
    await work.locator("#workspace > [data-view]:visible").count(),
    2,
  );
  assert.equal(await work.locator("#view-graph").isVisible(), true);
  assert.equal(await work.locator("#chat-avatar").isVisible(), false);
  assert.equal(
    await work.locator("#chat-input").inputValue(),
    "Черновик рабочего места",
  );
  const firstShare = Number(
    await work.locator("#workspace-separator").getAttribute("aria-valuenow"),
  );
  await work.locator("#workspace-separator").focus();
  await work.keyboard.press("ArrowLeft");
  assert.notEqual(
    Number(
      await work.locator("#workspace-separator").getAttribute("aria-valuenow"),
    ),
    firstShare,
  );
  const separator = await work.locator("#workspace-separator").boundingBox();
  await work.mouse.move(
    separator.x + separator.width / 2,
    separator.y + separator.height / 2,
  );
  await work.mouse.down();
  await work.mouse.move(separator.x - 70, separator.y + separator.height / 2, {
    steps: 8,
  });
  await work.mouse.up();
  const resizedShare = Number(
    await work.locator("#workspace-separator").getAttribute("aria-valuenow"),
  );
  assert.ok(resizedShare >= 35 && resizedShare <= 65);
  await work.locator("#workspace-context").selectOption("archive");
  await work.locator("#view-memory").waitFor({ state: "visible" });
  await work.waitForFunction(
    (count) =>
      document.querySelectorAll("#archive-list .archive-item").length === count,
    groupConversations(messages).length,
  );
  assert.equal(
    await work.locator("#chat-input").inputValue(),
    "Черновик рабочего места",
  );
  await work.locator("#chat-input").fill("Совместная работа с архивом");
  const beforeSend = messages.length;
  await work.locator("#chat-send").click();
  await work.waitForFunction(
    (count) =>
      document.querySelectorAll(".message").length === count &&
      !document.querySelector(".message.pending"),
    beforeSend + 2,
  );
  await work.locator("#archive-list .archive-item").first().click();
  await work
    .locator("#topic-conversation-messages .conversation-message")
    .filter({ hasText: "Совместная работа с архивом" })
    .waitFor();
  await work.locator("#topic-window-close").click();
  assert.equal(
    await work
      .locator(".message.user")
      .filter({ hasText: "Совместная работа с архивом" })
      .count(),
    1,
  );
  const otherWork = await workContext.newPage();
  otherWork.on("pageerror", (error) => errors.push(error.message));
  await otherWork.goto(base + "/#graph");
  await otherWork.locator("#view-graph").waitFor();
  await work.locator("#workspace-context").selectOption("graph");
  await work.locator("#view-graph").waitFor();
  await work.locator("#workspace-context").selectOption("archive");
  await otherWork.waitForFunction(
    () => AmayoriUI.workspace.preferences.split.target === "archive",
  );
  // A storage refresh on a graph route must not write its route back as the default context.
  await work.waitForTimeout(150);
  assert.equal(
    await work.locator("#workspace-context").inputValue(),
    "archive",
  );
  assert.equal(await work.locator("#view-memory").isVisible(), true);
  assert.equal(await otherWork.locator("#view-graph").isVisible(), true);
  await otherWork.close();
  // Enabling split on a full-screen map remembers that current context.
  await work.locator("#workspace-toggle").click();
  await work.locator('a.nav-link[data-page="graph"]').click();
  await work.locator("#view-graph").waitFor();
  await work.locator("#workspace-toggle").click();
  await work.locator('a.nav-link[data-page="chat"]').click();
  await work.locator("#view-graph").waitFor();
  assert.equal(await work.locator("#workspace-context").inputValue(), "graph");
  await work.locator("#chat-input").fill("Сохранить при переходах");
  await work.locator('a.nav-link[data-page="graph"]').click();
  await work.locator("#view-graph").waitFor({ state: "visible" });
  assert.equal(await work.locator("#view-chat").isVisible(), true);
  await work.locator('a.nav-link[data-page="memory"]').click();
  await work.locator("#archive-list .archive-item").first().click();
  await work.locator("#topic-conversation-reader").waitFor();
  await work.locator("#topic-window-close").click();
  assert.equal(
    await work.locator("#view-memory").isVisible(),
    true,
    "opening an archived message keeps the archive beside chat",
  );
  assert.equal(
    await work.locator("#chat-input").inputValue(),
    "Сохранить при переходах",
  );
  assert.equal(
    await work.evaluate(
      () => originalChat === document.getElementById("floating-chat"),
    ),
    true,
  );
  await work.locator("#tab-facts").click();
  await work.waitForFunction(
    () =>
      document.documentElement.dataset.page === "memory" &&
      document.getElementById("tab-facts").getAttribute("aria-selected") ===
        "true",
  );
  assert.equal(await work.locator("#workspace.workspace-split").count(), 0);
  await work.locator('a.nav-link[data-page="chat"]').click();
  await work.locator("#workspace.workspace-split").waitFor();
  assert.equal(
    await work.locator("#chat-input").inputValue(),
    "Сохранить при переходах",
  );
  check(
    "Split workspace keeps one chat and its draft; archive updates beside replies and remains open when selecting messages",
  );

  await work.locator('a.nav-link[data-page="settings"]').click();
  await work.locator("#tab-appearance").click();
  await work.locator("#workspace-settings summary").click();
  await work.locator("#workspace-chat-side").selectOption("left");
  await work.locator("#workspace-share").focus();
  await work.keyboard.press("Home");
  await work.keyboard.press("ArrowRight");
  const savedShare = await work.locator("#workspace-share").inputValue();
  await work.locator('a.nav-link[data-page="chat"]').click();
  await work.locator("#workspace.workspace-split").waitFor();
  const chatBox = await work.locator("#view-chat").boundingBox(),
    archiveBox = await work.locator("#view-memory").boundingBox();
  assert.ok(chatBox.x < archiveBox.x);
  await work.reload();
  await work.locator("#workspace.workspace-split").waitFor();
  assert.equal(
    await work.locator("#workspace").getAttribute("data-chat-side"),
    "left",
  );
  assert.equal(
    await work.locator("#workspace-separator").getAttribute("aria-valuenow"),
    savedShare,
  );
  assert.equal(await work.locator("#floating-chat").count(), 1);
  check(
    "Split side and pane sizes persist without changing full-screen settings and knowledge tabs",
  );

  await work.locator('a.nav-link[data-page="settings"]').click();
  await work.locator("#tab-appearance").click();
  await work.locator("#menu-settings summary").click();
  await work.locator('[data-menu-id="memory"] .menu-pin').click();
  assert.equal(
    await work.locator('#nav-pinned [data-nav-id="memory"]').count(),
    0,
  );
  assert.equal(await work.locator('[data-nav-id="memory"]').count(), 1);
  await work.locator('[data-menu-id="graph"] [data-direction="up"]').click();
  await work.locator('[data-menu-id="graph"] [data-direction="up"]').click();
  assert.equal(
    await work
      .locator("#nav-pinned .nav-link")
      .first()
      .getAttribute("data-nav-id"),
    "graph",
  );
  await work
    .locator('[data-menu-id="golem"] .menu-grip')
    .dragTo(work.locator('[data-menu-id="graph"]'));
  assert.equal(
    await work
      .locator("#nav-pinned .nav-link")
      .first()
      .getAttribute("data-nav-id"),
    "golem",
  );
  await work.locator("#nav-more").click();
  await work.locator('#nav-overflow [data-nav-id="memory"]').click();
  await work.waitForFunction(
    () => document.documentElement.dataset.page === "memory",
  );
  assert.equal(await work.locator("#nav-overflow").isVisible(), false);
  assert.equal(
    await work.locator("#nav-more").getAttribute("data-current"),
    "true",
  );
  await work.reload();
  await work.waitForFunction(
    () => document.documentElement.dataset.page === "memory",
  );
  assert.equal(
    await work
      .locator("#nav-pinned .nav-link")
      .first()
      .getAttribute("data-nav-id"),
    "golem",
  );
  assert.equal(
    await work.locator('#nav-pinned [data-nav-id="memory"]').count(),
    0,
  );
  assert.equal(
    await work.locator("#nav-more").getAttribute("data-current"),
    "true",
  );
  await work.locator('a.nav-link[data-page="settings"]').click();
  await work.locator("#tab-appearance").click();
  await work.locator("#menu-settings summary").click();
  for (const id of ["chat", "graph", "golem"])
    await work.locator('[data-menu-id="' + id + '"] .menu-pin').click();
  assert.equal(await work.locator("#nav-pinned a").count(), 0);
  assert.equal(
    await work.locator('.rail-bottom [data-page="settings"]').isVisible(),
    true,
  );
  await work.locator("#nav-more").click();
  await work.keyboard.press("ArrowDown");
  await work.keyboard.press("Escape");
  assert.equal(await work.locator("#nav-overflow").isVisible(), false);
  assert.equal(
    await work.evaluate(() => document.activeElement.id),
    "nav-more",
  );
  await work.locator("#reset-menu").click();
  assert.deepEqual(
    await work
      .locator("#nav-pinned .nav-link")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.navId)),
    ["chat", "memory", "graph", "golem"],
  );
  assert.equal(await work.locator("#nav-more").isVisible(), false);
  check(
    "Personal menu supports pinning, keyboard ordering, drag and drop, More navigation, persistence and reset without duplicate links",
  );

  for (const width of [320, 390, 768, 1024, 1366, 1920]) {
    await work.setViewportSize({
      width,
      height: width === 320 ? 640 : width < 600 ? 844 : 950,
    });
    for (const target of ["graph", "archive"]) {
      await work.evaluate((target) => {
        AmayoriUI.navigate("chat");
        AmayoriUI.workspace.updateSplit({
          enabled: true,
          target,
          chatSide: "right",
          share: 50,
        });
      }, target);
      await work.locator("#workspace.workspace-split").waitFor();
      const expectedAxis = await work.locator("#workspace").evaluate((el) => {
        const s = getComputedStyle(el);
        return el.clientWidth -
          parseFloat(s.paddingLeft) -
          parseFloat(s.paddingRight) <
          840
          ? "y"
          : "x";
      });
      await work.waitForFunction(
        (axis) =>
          document.getElementById("workspace").dataset.splitAxis === axis,
        expectedAxis,
      );
      await work.waitForTimeout(50);
      const bounds = await work.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        top: document.querySelector(".topbar").getBoundingClientRect().top,
        visible: [
          ...document.querySelectorAll("#workspace>[data-view]"),
        ].filter((x) => !x.hidden).length,
        chat: document
          .getElementById("view-chat")
          .getBoundingClientRect()
          .toJSON(),
        context: document
          .querySelector(
            '#workspace>[data-view]:not([data-view="chat"]):not([hidden])',
          )
          .getBoundingClientRect()
          .toJSON(),
      }));
      if (bounds.scroll !== bounds.width)
        console.log("Split overflow", width, target, bounds);
      assert.equal(bounds.width, bounds.scroll);
      assert.equal(bounds.top, 0);
      assert.equal(bounds.visible, 2);
      assert.ok(
        bounds.chat.width > 0 &&
          bounds.chat.height > 150 &&
          bounds.context.width > 0 &&
          bounds.context.height > 100,
      );
      if (expectedAxis === "x")
        assert.ok(bounds.context.right <= bounds.chat.left);
      else assert.ok(bounds.context.bottom <= bounds.chat.top);
      if (target === "graph") {
        await work.locator("#knowledge-map").focus();
        await work.keyboard.press("ArrowRight");
        await work
          .locator("#graph-inspector-close")
          .waitFor({ state: "visible" });
        await work.locator("#graph-inspector-close").click();
        assert.equal(await work.locator(".graph-inspector").isVisible(), false);
      }
    }
  }
  check(
    "Both split contexts fit desktop, tablet and small phones; map details remain usable within the pane",
  );

  const splitPhoneContext = await browserContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "Asia/Vladivostok",
  });
  await splitPhoneContext.route("**/api/**", mockRoute);
  const splitPhone = await splitPhoneContext.newPage();
  splitPhone.on("pageerror", (error) => errors.push(error.message));
  await splitPhone.addInitScript(() =>
    localStorage.removeItem("amayori-workspace"),
  );
  await splitPhone.goto(base + "/#chat");
  await splitPhone.locator(".message").first().waitFor();
  await splitPhone.locator("#workspace-toggle").tap();
  await splitPhone.locator("#workspace.workspace-split").waitFor();
  assert.equal(
    await splitPhone.locator("#workspace").getAttribute("data-split-axis"),
    "y",
  );
  await splitPhone.locator("#chat-input").fill("Две панели на телефоне");
  await splitPhone.keyboard.press("Enter");
  assert.ok(
    (await splitPhone.locator("#chat-input").inputValue()).endsWith("\n"),
  );
  await splitPhone.locator("#workspace-context").selectOption("archive");
  await splitPhone.locator("#view-memory").waitFor({ state: "visible" });
  assert.equal(await splitPhone.locator("#floating-chat").count(), 1);
  await work.evaluate(() =>
    localStorage.setItem("amayori-workspace", "{broken"),
  );
  await work.reload();
  await work.locator("#chat-input").waitFor();
  assert.equal(await work.locator("#workspace.workspace-split").count(), 0);
  assert.equal(await work.locator("#nav-pinned a").count(), 4);
  check(
    "Touch split mode preserves multiline drafts; malformed saved preferences recover to the approved default layout",
  );

  // Exercise the knowledge UI against the real isolated local repository.
  const knowledgeContext = await browserContext({
    viewport: { width: 1440, height: 950 },
    timezoneId: "Asia/Vladivostok",
  });
  const k = await knowledgeContext.newPage();
  k.on("pageerror", (error) => errors.push(error.message));
  await k.goto(base + "/#memory/facts");
  await k.locator("#knowledge-add").waitFor();
  async function addCard(
    object,
    {
      topic = "Дизайн",
      subject = "Amayori",
      predicate = "тема интерфейса",
    } = {},
  ) {
    if (await k.locator("#topic-window").isVisible())
      await k.locator("#topic-window-close").click();
    await k.locator("#knowledge-add").click();
    const form = k.locator("#knowledge-add-form");
    await form.locator("[name=subject]").fill(subject);
    await form.locator("[name=predicate]").fill(predicate);
    await form.locator("[name=object]").fill(object);
    await form.locator("[name=topic]").fill(topic);
    await form.locator("[name=kind]").selectOption("preference");
    await form.locator("[name=exclusive]").check();
    await form.locator("[type=submit]").click();
    await k.locator("#knowledge-add-dialog").waitFor({ state: "hidden" });
    await k.locator("#knowledge-detail-content .knowledge-value").waitFor();
  }
  await addCard("Матовый чёрный золотой интерфейс");
  assert.equal(await k.locator("#facts-list .fact-card").count(), 1);
  const firstId = await k
    .locator("#facts-list .fact-card")
    .getAttribute("data-fact-id");
  await k.locator("#knowledge-detail-close").click();
  await addCard("матовый чёрный золотой интерфейс.");
  assert.equal(await k.locator("#facts-list .fact-card").count(), 1);
  assert.equal(
    await k.locator("#facts-list .fact-card").getAttribute("data-fact-id"),
    firstId,
  );
  await k.locator("#knowledge-detail-close").click();
  await addCard("Белая тема");
  assert.equal(
    await k.locator("#knowledge-status-filter").inputValue(),
    "candidate",
  );
  await k
    .getByRole("button", { name: "Сделать актуальным", exact: true })
    .click();
  await k
    .locator("#knowledge-detail-content")
    .getByText("История изменений", { exact: true })
    .waitFor();
  await k.locator("#knowledge-status-filter").selectOption("active");
  await k.locator("#facts-list .fact-open").first().click();
  await k
    .locator("#knowledge-detail-content .knowledge-value")
    .filter({ hasText: "Белая тема" })
    .waitFor();
  await k.reload();
  await k.locator('.topic-folder[data-topic-path="Дизайн"]').click();
  await k.locator("#facts-list .fact-open").first().click();
  await k
    .locator("#knowledge-detail-content")
    .getByText("История изменений", { exact: true })
    .waitFor();
  await k.locator("#knowledge-detail-close").click();
  await addCard("Белая тема проекта");
  await k
    .getByRole("button", { name: "Объединить с этой карточкой", exact: true })
    .click();
  await k
    .locator("#knowledge-detail-content")
    .getByText("История изменений", { exact: true })
    .waitFor();
  assert.equal(
    (await (await k.request.get(base + "/api/knowledge/facts")).json()).total,
    1,
  );
  await k.locator("#knowledge-detail-close").click();
  await addCard('<img src=x onerror="window.injected=true">', {
    topic: "Безопасность",
    subject: "Тест",
    predicate: "текст",
  });
  assert.equal(await k.evaluate(() => window.injected), undefined);
  assert.equal(await k.locator("#knowledge-detail-content img").count(), 0);
  await k.locator("#knowledge-detail-close").click();
  await k.locator("#knowledge-topic-filter").selectOption("Дизайн");
  await k.waitForFunction(
    () => document.querySelectorAll("#facts-list .fact-card").length === 1,
  );
  await k.locator("#knowledge-topic-filter").selectOption("");
  await k.waitForFunction(
    () => document.querySelectorAll("#facts-list .fact-card").length === 2,
  );
  const selectedCard = k
    .locator("#facts-list .fact-card")
    .filter({ hasText: "Белая тема проекта" });
  await selectedCard.locator(".fact-open").click();
  await k
    .locator("#knowledge-detail-content .knowledge-value")
    .filter({ hasText: "Белая тема проекта" })
    .waitFor();
  for (const width of [320, 390, 768, 1366, 1920]) {
    await k.setViewportSize({ width, height: 950 });
    await k.waitForTimeout(30);
    const bounds = await k.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      top: document.querySelector(".topbar").getBoundingClientRect().top,
      detail: document
        .getElementById("knowledge-detail")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.equal(bounds.width, bounds.scroll, "knowledge detail fits " + width);
    assert.equal(bounds.top, 0);
    assert.ok(bounds.detail.height > 180);
    const windowBounds = await k.locator("#topic-window").boundingBox();
    assert.ok(
      windowBounds.x >= 0 && windowBounds.x + windowBounds.width <= width + 1,
    );
    await k.locator("#topic-window-close").click();
    const add = k.locator("#knowledge-add");
    await add.click();
    const form = k.locator("#knowledge-add-dialog");
    assert.equal(await form.isVisible(), true);
    const dialog = await form.boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width + 1);
    await k.keyboard.press("Escape");
    await k.locator('.topic-folder[data-topic-path="Дизайн"]').click();
    await selectedCard.locator(".fact-open").click();
    await k
      .locator("#knowledge-detail-content .knowledge-value")
      .filter({ hasText: "Белая тема проекта" })
      .waitFor();
  }
  await k.locator("#topic-window-close").click();
  await Promise.all([
    k.waitForResponse(
      (r) =>
        r.url().endsWith("/api/knowledge/extraction") &&
        r.request().method() === "POST",
    ),
    k.locator("#knowledge-auto").uncheck(),
  ]);
  await k.reload();
  assert.equal(await k.locator("#knowledge-auto").isChecked(), false);
  await k.locator("#knowledge-extract").click();
  await k
    .locator("#knowledge-extract-text")
    .fill("Моя выбранная тема — чёрно-золотая");
  await k.locator("#knowledge-extract-form [type=submit]").click();
  await k
    .locator("#knowledge-extract-error")
    .filter({ hasText: "Выберите модель Cloud.ru" })
    .waitFor();
  await k.keyboard.press("Escape");
  check(
    "Real local knowledge cards merge repeats, retain chosen versions and sources, filter by topic and safely render user content; desktop/mobile details and forms fit 320–1920 px",
  );

  // Seed only the isolated fixture: verify full source conversations outside the last 100 messages.
  const oldMessages = Array.from({ length: 140 }, (_, i) => ({
    id: "archive-" + i,
    role: i % 2 ? "assistant" : "user",
    content:
      i === 0
        ? "Старый разговор о дизайне"
        : i === 120
          ? 'Строка 120 <img src=x onerror="window.injected=true">'
          : "Строка " + i,
    at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
  oldMessages.push(
    {
      id: "recent-user",
      role: "user",
      content: "Новая отдельная беседа",
      at: "2026-01-02T00:00:00Z",
    },
    {
      id: "recent-answer",
      role: "assistant",
      content: "Новый ответ",
      at: "2026-01-02T00:00:01Z",
    },
  );
  await fs.writeFile(
    path.join(temp, "data", "chats.json"),
    JSON.stringify(oldMessages),
  );
  const known = JSON.parse(
    await fs.readFile(path.join(temp, "data", "knowledge.json"), "utf8"),
  );
  const white = known.facts.find(
    (f) => f.object === "Белая тема проекта" && f.status === "active",
  );
  white.sources.push({
    kind: "cloudru-extracted",
    messageId: "archive-120",
    excerpt: oldMessages[120].content,
    at: oldMessages[120].at,
  });
  await fs.writeFile(
    path.join(temp, "data", "knowledge.json"),
    JSON.stringify(known),
  );
  await delay(5100); // The production archive cache has a five-second freshness window.
  await k.locator('a.nav-link[data-page="chat"]').click();
  await k.locator("#chat-input").fill("Черновик остаётся в текущем чате");
  await k.locator('a.nav-link[data-page="memory"]').click();
  await k.locator("#tab-facts").click();
  await k.locator('.topic-folder[data-topic-path="Дизайн"]').click();
  await k.locator("#topic-tab-conversations").click();
  await k.locator("#topic-conversation-list .conversation-item").waitFor();
  assert.equal(
    await k.locator("#topic-conversation-list .conversation-item").count(),
    1,
  );
  await k.locator("#topic-conversation-list .conversation-item").click();
  await k
    .locator("#topic-conversation-messages .conversation-message")
    .first()
    .waitFor();
  assert.equal(
    await k
      .locator("#topic-conversation-messages .conversation-message")
      .count(),
    50,
  );
  await k.locator("#topic-conversation-next").click();
  await k.waitForFunction(() =>
    document
      .getElementById("topic-conversation-position")
      .textContent.startsWith("51"),
  );
  await k.locator("#topic-conversation-next").click();
  await k.waitForFunction(() =>
    document
      .getElementById("topic-conversation-position")
      .textContent.startsWith("101"),
  );
  assert.equal(
    await k
      .locator("#topic-conversation-messages .conversation-message")
      .count(),
    40,
  );
  assert.equal(await k.locator("#topic-conversation-messages img").count(), 0);
  await k.locator("#topic-tab-knowledge").click();
  await k.locator("#facts-list .fact-open").first().click();
  await k.getByRole("button", { name: "Открыть беседу", exact: true }).click();
  await k.locator("#topic-conversation-messages .is-source").waitFor();
  assert.equal(
    await k
      .locator("#topic-conversation-messages .is-source")
      .getAttribute("data-message-id"),
    "archive-120",
  );
  assert.equal(
    await k.evaluate(() => document.documentElement.dataset.page),
    "memory",
  );
  assert.equal(
    await k.locator("#chat-input").inputValue(),
    "Черновик остаётся в текущем чате",
  );
  assert.equal(await k.locator("dialog[open]").count(), 1);
  for (const width of [320, 390, 768, 1366]) {
    await k.setViewportSize({ width, height: 844 });
    const rect = await k.locator("#topic-window").boundingBox();
    assert.ok(
      rect.x >= 0 &&
        rect.x + rect.width <= width + 1 &&
        rect.y >= 0 &&
        rect.y + rect.height <= 845,
      "conversation window fits " + width,
    );
    const scroll = await k.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.equal(scroll.width, scroll.scroll);
  }
  await k.locator("#topic-window-close").click();
  await k.locator("#tab-archive").click();
  await k.waitForFunction(
    () =>
      document.querySelectorAll("#archive-list .conversation-item").length ===
      2,
  );
  await k.locator("#archive-search").fill("Строка 120");
  await k.waitForFunction(
    () =>
      document.querySelectorAll("#archive-list .conversation-item").length ===
      1,
  );
  await k.locator("#archive-list .conversation-item").click();
  await k.locator("#topic-conversation-messages .is-source").waitFor();
  assert.equal(
    await k
      .locator("#topic-conversation-messages .is-source")
      .getAttribute("data-message-id"),
    "archive-120",
  );
  await k.locator("#topic-window-close").click();
  check(
    "Topic folders show one row per conversation; old messages page completely, search and evidence open the exact message in the same centered window without changing the current chat or its draft",
  );

  // Attention markers and topic cleanup act on real persisted knowledge.
  await k.setViewportSize({ width: 1440, height: 950 });
  for (const body of [
    {
      subject: "Amayori",
      predicate: "меню",
      object: "SVG",
      topic: "Amayori / Дизайн",
    },
    {
      subject: "Amayori",
      predicate: "оформление",
      object: "Золото",
      topic: "Amayori / Внешний вид",
    },
  ])
    assert.equal(
      (
        await k.request.post(base + "/api/knowledge/facts", { data: body })
      ).status(),
      200,
    );
  await k.locator("#tab-facts").click();
  const rootFolder = k.locator('.topic-folder[data-topic-path="Amayori"]');
  await rootFolder.locator(".topic-attention-marker").waitFor();
  await rootFolder.click();
  assert.equal(await k.locator("#topic-children button").count(), 2);
  await k.locator("#topic-tab-attention").click();
  await k.locator(".topic-issue .button").click();
  await k.waitForFunction(
    () => document.querySelectorAll("#topic-children button").length === 1,
  );
  const merged = (
    await (await k.request.get(base + "/api/knowledge/folders")).json()
  ).folders;
  assert.equal(
    merged.some((f) => f.path === "Amayori / Дизайн"),
    false,
  );
  assert.equal(
    merged.some((f) => f.path === "Amayori / Внешний вид"),
    true,
  );
  await k.locator("#topic-window-close").click();
  for (const object of ["Тёмная", "Светлая"])
    assert.equal(
      (
        await k.request.post(base + "/api/knowledge/facts", {
          data: {
            subject: "Amayori",
            predicate: "тема",
            object,
            topic: "Amayori / Внешний вид",
            exclusive: true,
          },
        })
      ).status(),
      200,
    );
  await k.reload();
  await rootFolder.locator(".topic-attention-marker").waitFor();
  await rootFolder.click();
  await k.locator("#topic-tab-attention").click();
  await k.getByRole("button", { name: "Открыть знание", exact: true }).click();
  await k
    .getByRole("button", { name: "Сделать актуальным", exact: true })
    .click();
  await k.locator("#topic-tab-attention").waitFor({ state: "hidden" });
  await k.locator("#topic-window-close").click();
  assert.equal(await rootFolder.locator(".topic-attention-marker").count(), 0);
  check(
    "Folder badges reflect actual issues; related topic names merge with source preservation and disappear after resolution, while one-window navigation remains usable",
  );

  // Keep a delayed retry pending across the same refresh used by the eight-second poll.
  let retryCalls = 0, releaseRetry;
  const retryGate = new Promise(resolve => { releaseRetry = resolve; });
  const retryFolder = {path:"Проверка",name:"Проверка",count:1,active:1,conversations:1,attention:1,children:[],issues:[{type:"extraction",label:"Ошибка разбора",messageId:"retry-message"}]};
  await k.route("**/api/knowledge/folders", route => route.fulfill({json:{folders:[retryFolder],roots:["Проверка"],total:1}}));
  await k.route("**/api/knowledge/extract", async route => {
    retryCalls++;
    await retryGate;
    await route.fulfill({status:503,json:{error:"Повторите позже"}});
  });
  await k.evaluate(() => window.AmayoriUI.topics.load());
  await k.locator('.topic-folder[data-topic-path="Проверка"]').click();
  await k.locator("#topic-tab-attention").click();
  const retryButton = k.locator('[data-retry-message-id="retry-message"]');
  await Promise.all([k.waitForRequest(r => r.url().endsWith("/api/knowledge/extract")),retryButton.click()]);
  assert.equal(await retryButton.isDisabled(),true);
  await k.evaluate(() => window.AmayoriUI.topics.load());
  assert.equal(await retryButton.isDisabled(),true,"refresh keeps the request disabled");
  await k.evaluate(() => document.querySelector('[data-retry-message-id="retry-message"]').click());
  await k.locator("#topic-window-close").click();
  await k.locator('.topic-folder[data-topic-path="Проверка"]').click();
  await k.locator("#topic-tab-attention").click();
  assert.equal(await retryButton.isDisabled(),true,"reopening keeps the request disabled");
  assert.equal(retryCalls,1,"only one Cloud request can be pending per message");
  releaseRetry();
  await k.locator("#topic-window-status").filter({hasText:"Повторите позже"}).waitFor();
  await k.waitForFunction(() => !document.querySelector('[data-retry-message-id="retry-message"]').disabled);
  await k.locator("#topic-window-close").click();
  check("A pending manual retry stays disabled through attention refreshes and reopening, sends one request, and becomes available again after an error");

  const navContext = await browserContext({viewport:{width:1440,height:950}});
  await navContext.route("**/api/**", mockRoute);
  const navFolders = [
    {path:"Amayori",name:"Amayori",children:["Amayori / Дизайн"],count:2,active:2,conversations:34,attention:1,issues:[{type:"source",factId:"1",label:"Проверить источник"}]},
    {path:"Amayori / Дизайн",name:"Дизайн",children:[],count:2,active:2,conversations:34,attention:0,issues:[]},
    ...Array.from({length:44},(_,i)=>({path:"Тема "+i,name:"Тема "+i,children:[],count:1,active:1,conversations:0,attention:i===17?1:0,issues:i===17?[{type:"source",factId:"1",label:"Проверить источник"}]:[]})),
  ];
  const navOverview = {folders:navFolders,roots:navFolders.filter(f=>!f.path.includes(" / ")).map(f=>f.path),total:46};
  await navContext.route("**/api/knowledge/folders", route=>route.fulfill({json:navOverview}));
  const navMessages = Array.from({length:34},(_,i)=>({id:"nav-"+i,conversation:"nav-conversation-"+i,role:"user",content:i===0?"Вводный текст ".repeat(60)+"Уникальная строка <img src=x onerror=alert(1)>":"Разговор о дизайне "+i,at:new Date(Date.UTC(2026,0,1,0,i)).toISOString()}));
  navMessages.push({id:"foreign",conversation:"foreign",role:"user",content:"Уникальная строка из другой темы",at:"2026-02-01"});
  const navGroups = groupConversations(navMessages).map(g=>({...g,topics:[g.canonicalId==="foreign"?"Другая тема":"Amayori / Дизайн"]}));
  await navContext.route("**/api/conversations/grouped?*",route=>route.fulfill({json:listConversations(navGroups,Object.fromEntries(new URL(route.request().url()).searchParams))}));
  await navContext.route("**/api/conversations/item?*",route=>{
    const params=new URL(route.request().url()).searchParams;
    return route.fulfill({json:conversationPage(navGroups,params.get("id"),Object.fromEntries(params))});
  });
  const navPage=await navContext.newPage();
  navPage.on("pageerror", error=>errors.push(error.message));
  await navPage.goto(base+"/#memory/facts");
  await navPage.waitForFunction(()=>document.querySelectorAll(".topic-folder").length===45);
  const pinWork=navPage.locator('[data-pin-path="Тема 32"]');
  await pinWork.click();
  assert.equal(await navPage.locator(".topic-folder").first().getAttribute("data-topic-path"),"Тема 32");
  assert.equal(await navPage.locator("dialog[open]").count(),0,"pinning never opens a folder");
  await pinWork.focus();
  await navPage.evaluate(()=>{globalThis.savedPinFocus=document.activeElement;return window.AmayoriUI.topics.load();});
  assert.equal(await navPage.evaluate(()=>document.activeElement===globalThis.savedPinFocus),true,"unchanged polling preserves the focused control");
  await navPage.locator("#topic-folder-filter").selectOption("pinned");
  assert.equal(await navPage.locator(".topic-folder").count(),1);
  await navPage.reload();
  await navPage.locator('[data-pin-path="Тема 32"][aria-pressed="true"]').waitFor();
  await navPage.locator("#topic-folder-filter").selectOption("pinned");
  await navPage.locator('[data-pin-path="Тема 32"]').click();
  await navPage.getByRole("button",{name:"Показать все темы",exact:true}).click();
  await navPage.locator("#topic-folder-search").fill("дизайн");
  assert.equal(await navPage.locator(".topic-folder").count(),1);
  assert.match(await navPage.locator(".topic-folder").textContent(),/Подтемы: Дизайн/);
  await navPage.locator("#topic-folder-search").fill("неизвестная папка");
  await navPage.getByRole("button",{name:"Сбросить поиск и фильтр",exact:true}).click();
  await navPage.locator("#topic-folder-filter").selectOption("attention");
  assert.equal(await navPage.locator(".topic-folder").count(),2);
  navFolders[0].attention=0;navFolders[0].issues=[];
  await navPage.evaluate(()=>window.AmayoriUI.topics.load());
  assert.equal(await navPage.locator(".topic-folder").count(),1);
  assert.equal(await navPage.locator(".topic-folder").getAttribute("data-topic-path"),"Тема 17");
  await navPage.locator("#topic-folder-filter").selectOption("all");
  await navPage.locator('[data-pin-path="Amayori"]').click();
  const otherNavPage=await navContext.newPage();
  await otherNavPage.goto(base+"/#memory/facts");
  await otherNavPage.locator('[data-pin-path="Amayori"][aria-pressed="true"]').waitFor();
  await otherNavPage.locator('[data-pin-path="Amayori"]').click();
  await navPage.locator('[data-pin-path="Amayori"][aria-pressed="false"]').waitFor();
  await otherNavPage.close();
  await navPage.evaluate(()=>localStorage.setItem("amayori-topic-navigation","broken JSON"));
  await navPage.reload();
  await navPage.waitForFunction(()=>document.querySelectorAll(".topic-folder").length===45);
  assert.equal(await navPage.locator('.topic-folder-pin[aria-pressed="true"]').count(),0);
  for(const width of [320,390,768,1440]){
    await navPage.setViewportSize({width,height:844});
    assert.equal(await navPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1),true,"many folders stay inside the page at "+width);
    const box=await navPage.locator("#topic-folders").boundingBox();
    assert.ok(box.height>30&&box.y+box.height<=844);
    await navPage.locator("#topic-folder-search").fill("дизайн");
    assert.equal(await navPage.locator(".topic-folder").count(),1);
    await navPage.locator("#topic-folder-search").fill("");
  }
  check("Folder navigation searches child themes, pins without opening or duplicating folders, survives reloads and malformed preferences, syncs across tabs, preserves focus and fits 45 folders at 320–1440 px");
  await navPage.locator('a.nav-link[data-page="chat"]').click();
  await navPage.locator("#chat-input").fill("Черновик поиска памяти");
  await navPage.locator('a.nav-link[data-page="memory"]').click();
  await navPage.locator("#tab-facts").click();
  await navPage.locator('.topic-folder[data-topic-path="Amayori"]').click();
  await navPage.locator("#topic-tab-conversations").click();
  await navPage.waitForFunction(()=>document.querySelectorAll("#topic-conversation-list .conversation-item").length===30);
  await navPage.locator("#topic-conversation-more").click();
  await navPage.waitForFunction(()=>document.querySelectorAll("#topic-conversation-list .conversation-item").length===34);
  await navPage.locator("#topic-conversation-search").fill("уникальная строка");
  await navPage.waitForFunction(()=>document.querySelectorAll("#topic-conversation-list .conversation-item").length===1);
  assert.equal(await navPage.locator("#topic-conversation-more").isVisible(),false);
  assert.equal(await navPage.locator("#topic-conversation-list mark").textContent(),"Уникальная строка");
  await navPage.locator("#topic-conversation-list .conversation-item").click();
  await navPage.locator('.conversation-message.is-source[data-message-id="nav-0"]').waitFor();
  assert.equal(await navPage.locator("#topic-conversation-messages img").count(),0);
  assert.equal(await navPage.locator("dialog[open]").count(),1);
  assert.equal(await navPage.locator("#chat-input").inputValue(),"Черновик поиска памяти");
  await navPage.locator("#topic-conversation-back").click();
  assert.equal(await navPage.locator("#topic-conversation-search").inputValue(),"уникальная строка");
  await navPage.locator("#topic-conversation-search").fill("совпадений не существует");
  await navPage.locator("#topic-conversation-list h3").filter({hasText:"В этой папке совпадений нет"}).waitFor();
  await navPage.locator("#topic-conversation-search").fill("");
  await navPage.waitForFunction(()=>document.querySelectorAll("#topic-conversation-list .conversation-item").length===30);
  await navPage.locator("#topic-window-close").click();
  check("Folder conversation search resets paging, excludes other themes, shows matching long-message snippets, opens the exact safe source and preserves its query and the current chat draft");

  assert.deepEqual(errors, [], "no browser JavaScript errors");
  console.log(
    checks.map((value, index) => index + 1 + ". " + value).join("\n"),
  );
  console.log("Interface checks passed. No real Cloud.ru requests were sent.");
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill();
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", resolve);
    });
  }
  await fs.rm(temp, { recursive: true, force: true });
}
