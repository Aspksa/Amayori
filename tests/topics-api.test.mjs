import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createKnowledgeRepository } from "../core/knowledge-repository.mjs";

test("folder and conversation APIs preserve full old history, source navigation and explicit topic merging", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "amayori-topics-"));
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  for (const name of ["core", "public", "server.mjs", "package.json"])
    await fs.cp(name, path.join(temp, name), { recursive: true });
  await fs.mkdir(path.join(temp, "data"));
  const messages = Array.from({ length: 140 }, (_, i) => ({
    id: "m" + i,
    conversation: "existing",
    role: i % 2 ? "assistant" : "user",
    content:
      i === 0
        ? "Самое старое обсуждение"
        : i === 120
          ? '<img src=x onerror="window.injected=true">'
          : "Сообщение " + i,
    at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
  messages.push({
    id: "new",
    role: "user",
    content: "Вторая отдельная беседа",
    at: "2026-01-02T00:00:00Z",
  });
  await fs.writeFile(path.join(temp,"data/conversations.json"),JSON.stringify([{id:"existing",title:"Сохранённое название"}]));
  const archive = JSON.stringify(messages);
  await fs.writeFile(path.join(temp, "data/chats.json"), archive);
  let state = { version: 1, facts: [] };
  const repo = createKnowledgeRepository({
    postgres: () => false,
    load: async () => structuredClone(state),
    persist: async (value) => {
      state = structuredClone(value);
    },
  });
  const [fact] = await repo.save(
    [
      {
        subject: "Amayori",
        predicate: "стиль",
        object: "Чёрный",
        topic: "Amayori / Дизайн",
        exclusive: true,
      },
    ],
    {
      kind: "cloudru-extracted",
      messageId: "m120",
      excerpt: messages[120].content,
      at: messages[120].at,
    },
  );
  await repo.save([
    {
      subject: "Amayori",
      predicate: "меню",
      object: "SVG",
      topic: "Amayori / Внешний вид",
    },
  ]);
  await fs.writeFile(
    path.join(temp, "data/knowledge.json"),
    JSON.stringify(state),
  );
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: temp,
    env: {
      ...process.env,
      PORT: String(port),
      AMAYORI_DATABASE_URL: "",
      AMAYORI_GOLEM_AUTO_BUILD: "0",
      AMAYORI_AUTO_EXTRACT: "0",
    },
    stdio: "ignore",
  });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await delay(50);
  }
  const get = async (endpoint) => {
    const r = await fetch(base + endpoint);
    assert.equal(r.status, 200, endpoint);
    return r.json();
  };
  const post = async (endpoint, body) => {
    const r = await fetch(base + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200, endpoint);
    return r.json();
  };
  const overview = await get("/api/knowledge/folders");
  assert.deepEqual(overview.roots, ["Amayori"]);
  const root = overview.folders.find((f) => f.path === "Amayori");
  assert.equal(root.count, 2);
  assert.equal(root.conversations, 1);
  assert.equal(root.attention, 1);
  const search = await get(
    "/api/conversations/grouped?q=" + encodeURIComponent("Самое старое"),
  );
  assert.equal(search.total, 1);
  assert.equal(search.conversations[0].messages, 140);
  const all = await get("/api/conversations/grouped");
  assert.equal(all.total, 2);
  assert.equal(all.conversations.find(c=>c.canonicalId==="existing").title,"Сохранённое название");
  await post("/api/conversations/rename",{id:"existing",title:"Моё название"});
  assert.equal((await get("/api/conversations/grouped")).conversations.find(c=>c.canonicalId==="existing").title,"Моё название");
  assert.equal(Object.hasOwn(all.conversations[0], "content"), false);
  const inTopic = await get(
    "/api/conversations/grouped?topic=" + encodeURIComponent("Amayori / Дизайн"),
  );
  assert.equal(inTopic.total, 1);
  const source = await get(
    "/api/conversations/source?factId=" + fact.id + "&messageId=m120",
  );
  const detailed = await get("/api/knowledge/card?id=" + fact.id);
  assert.equal(detailed.sources[0].excerpt, messages[120].content);
  assert.equal(source.offset, 100);
  assert.equal(
    source.messages.find((m) => m.id === "m120").content,
    messages[120].content,
  );
  const initial = await get(
    "/api/conversations/item?id=" + inTopic.conversations[0].id,
  );
  assert.equal(initial.messages.length, 50);
  assert.equal(initial.total, 140);
  const missing = await fetch(
    base + "/api/conversations/source?factId=" + fact.id + "&messageId=wrong",
  );
  assert.equal(missing.status, 404);
  await post("/api/knowledge/topics/merge", {
    from: "Amayori / Внешний вид",
    to: "Amayori / Дизайн",
  });
  assert.equal(
    (await get("/api/knowledge/folders")).folders.find(
      (f) => f.path === "Amayori",
    ).attention,
    0,
  );
  const [newFact] = await Promise.all([
    post("/api/knowledge/facts", {
      subject: "Amayori",
      predicate: "шрифт",
      object: "Системный",
      topic: "Amayori / Внешний вид",
    }),
  ]);
  assert.equal(
    (await get("/api/knowledge/card?id=" + newFact.id)).topic,
    "Amayori / Дизайн",
  );
  await post("/api/knowledge/topic", {
    id: newFact.id,
    topic: "Личное / Предпочтения",
  });
  assert.equal(
    (await get("/api/knowledge/card?id=" + newFact.id)).topic,
    "Личное / Предпочтения",
  );
  assert.equal(
    await fs.readFile(path.join(temp, "data/chats.json"), "utf8"),
    archive,
    "reading and organizing never rewrite or prune the chat archive",
  );
  assert.equal((await get("/api/conversations/grouped")).total, 2);
  const created = await post("/api/conversations", {title:"Мой диалог"});
  assert.ok((await get("/api/conversations")).conversations.some(c=>c.id===created.id));
  const response=await fetch(base+"/api/chats?id=m120",{method:"DELETE"});
  assert.equal(response.status,200);
  const refreshed=await get("/api/conversations/grouped?q="+encodeURIComponent(messages[120].content));
  assert.equal(refreshed.total,0,"deletion invalidates the full-archive cache immediately");
  assert.equal((await get("/api/conversations/item?id="+inTopic.conversations[0].id)).total,139);
});
