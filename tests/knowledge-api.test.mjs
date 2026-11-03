import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

test("knowledge HTTP workflow persists cards, versions, topics, sources and automatic extraction without real cloud calls", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "amayori-knowledge-"));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  for (const name of ["core", "public", "server.mjs", "package.json"])
    await fs.cp(name, path.join(temp, name), { recursive: true });
  await fs.mkdir(path.join(temp, "data"));
  await fs.writeFile(
    path.join(temp, "data", "cloudru-settings.json"),
    JSON.stringify({
      model: "fake",
      apiKey: "not-real",
      endpoint: "https://foundation-models.api.cloud.ru/v1/chat/completions",
    }),
  );
  const mock = path.join(temp, "cloud-mock.mjs");
  await fs.writeFile(
    mock,
    `globalThis.fetch=async(url,options)=>{
    if(!String(url).startsWith('https://foundation-models.api.cloud.ru/'))throw Error('Unexpected external request');
    const body=JSON.parse(options.body),extract=body.messages[0].content.includes('Максимум 5 фактов');
    const fact={subject:'Amayori',predicate:'стиль',object:'Чёрно-золотой',topic:'Дизайн',kind:'preference',exclusive:true};
    const content=extract?JSON.stringify({facts:[fact]}):body.messages[0].content;
    return new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'Content-Type':'application/json'}});
  };`,
  );
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = "http://127.0.0.1:" + port;
  async function start() {
    child = spawn(
      process.execPath,
      ["--import", pathToFileURL(mock).href, "server.mjs"],
      {
        cwd: temp,
        env: {
          ...process.env,
          PORT: String(port),
          AMAYORI_DATABASE_URL: "",
          AMAYORI_GOLEM_AUTO_BUILD: "0",
          AMAYORI_AUTO_EXTRACT: "1",
          AMAYORI_CLOUD_STREAM: "0",
        },
        stdio: "ignore",
      },
    );
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) return;
      } catch {}
      await delay(50);
    }
    throw Error("Knowledge test server failed to start");
  }
  const get = async (endpoint) => {
    const r = await fetch(base + endpoint);
    assert.equal(r.status, 200, endpoint);
    return r.json();
  };
  const post = async (endpoint, body, status = 200) => {
    const r = await fetch(base + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, status, endpoint);
    return r.json();
  };
  await start();
  const input = {
    subject: "Amayori",
    predicate: "тема",
    object: "Чёрная",
    kind: "preference",
    topic: "Дизайн",
    exclusive: true,
  };
  const old = await post("/api/knowledge/facts", input);
  const repeat = await post("/api/knowledge/facts", {
    ...input,
    object: "черная.",
  });
  assert.equal(repeat.id, old.id);
  assert.equal(repeat.merged, true);
  const newer = await post("/api/knowledge/facts", {
    ...input,
    object: "Белая",
  });
  assert.equal(newer.status, "candidate");
  assert.equal((await get("/api/knowledge/facts")).facts[0].id, old.id);
  await post("/api/knowledge/choose", { id: newer.id });
  const detail = await get("/api/knowledge/card?id=" + newer.id);
  assert.equal(detail.history[0].id, old.id);
  const graph = await get("/api/knowledge/graph");
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].target, "белая");
  const answer = await post("/api/chat", { message: "Какая тема у Amayori?" });
  assert.match(answer.answer, /Белая/);
  assert.doesNotMatch(answer.answer, /Чёрная/);
  for (let i = 0; i < 100; i++) {
    if ((await get("/api/knowledge/extraction")).completed) break;
    await delay(30);
  }
  assert.equal((await get("/api/knowledge/extraction")).completed, 1);
  const auto = (await get("/api/knowledge/facts?kind=preference")).facts.find(
    (f) => f.predicate === "стиль",
  );
  assert.ok(auto);
  assert.equal(auto.source, "cloudru-extracted");
  assert.equal(auto.sources[0].excerpt, "Какая тема у Amayori?");
  const chats = (await get("/api/chats")).messages;
  assert.ok(chats[0].id);
  await post("/api/knowledge/extract", {
    sourceMessageId: chats[0].id,
    text: "Подменённый текст",
  });
  const refreshed = await get("/api/knowledge/card?id=" + auto.id);
  assert.equal(
    refreshed.sources.length,
    1,
    "same source message is not duplicated",
  );
  assert.equal(refreshed.sources[0].excerpt, chats[0].content);
  const localSource = await get("/api/golem/source?id=" + auto.id);
  assert.equal(localSource.message.content, chats[0].content);
  await post("/api/knowledge/extract", { text: "Повторяю свой выбор" });
  assert.equal(
    (await get("/api/knowledge/card?id=" + auto.id)).sources.length,
    2,
  );
  await post("/api/knowledge/extract", { sourceMessageId: chats[1].id }, 404);
  await post("/api/knowledge/facts", { subject: "bad" }, 400);
  await post("/api/knowledge/choose", { id: "missing" }, 404);
  const malformed = await fetch(base + "/api/knowledge/facts?status=bad");
  assert.equal(malformed.status, 400);
  await post("/api/knowledge/extraction", { enabled: false });
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await start();
  assert.equal((await get("/api/knowledge/extraction")).enabled, false);
  assert.equal(
    (await get("/api/knowledge/card?id=" + newer.id)).history[0].id,
    old.id,
  );
  assert.equal((await get("/api/knowledge/facts?status=all")).total, 3);
  assert.equal((await get("/api/chats")).messages[0].id, chats[0].id);
});
