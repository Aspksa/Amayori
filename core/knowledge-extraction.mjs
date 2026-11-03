import { read, write, chatHistory } from "./store.mjs";
import { knowledge } from "./knowledge-repository.mjs";
import { extractKnowledge } from "./knowledge-extractor.mjs";

// Durable, single-worker queue. A failed cloud call is retried only on an explicit
// request. Saved source IDs make ingestion idempotent after restart.
export function createExtractionService({
  load = () => read("knowledge-extraction.json", null),
  persist = (value) => write("knowledge-extraction.json", value),
  history = chatHistory,
  repository = knowledge,
  extract = extractKnowledge,
  getConfig,
  emit = () => {},
  forcedOff = () => process.env.AMAYORI_AUTO_EXTRACT === "0",
} = {}) {
  let data,
    initializing,
    chain = Promise.resolve(),
    runner = null;
  async function init() {
    if (!initializing)
      initializing = (async () => {
        const saved = await load();
        if (
          saved !== null &&
          (saved.version !== 1 || !Array.isArray(saved.jobs))
        )
          throw Error("Очередь извлечения знаний повреждена");
        data = saved || {
          version: 1,
          enabled: true,
          jobs: [],
          lastError: "",
          lastRun: null,
        };
        for (const job of data.jobs)
          if (job.status === "running") job.status = "waiting";
      })();
    await initializing;
  }
  function change(fn) {
    const next = chain.then(async () => {
      await init();
      const result = fn();
      await persist(data);
      return result;
    });
    chain = next.catch(() => {});
    return next;
  }
  async function run() {
    while (true) {
      await chain;
      await init();
      if (!data.enabled || forcedOff()) break;
      const pending = data.jobs.find((j) => j.status === "waiting");
      if (!pending) break;
      const config = await getConfig();
      if (!config.apiKey || !config.model) {
        await change(() => {
          data.lastError =
            "Для извлечения знаний выберите модель и сохраните ключ Cloud.ru";
        });
        break;
      }
      await change(() => {
        pending.status = "running";
        data.lastError = "";
      });
      emit("knowledge-extraction", { state: "running" });
      try {
        const existing = (
          await repository.list({ status: "active", limit: 15 })
        ).facts;
        const facts = await extract(config, pending.text, { existing });
        const saved = await repository.save(facts, {
          kind: "cloudru-extracted",
          messageId: pending.id,
          excerpt: pending.text,
          at: pending.at,
        });
        await change(() => {
          pending.status = "done";
          pending.count = saved.length;
          pending.text = "";
          data.lastRun = new Date().toISOString();
        });
        emit("facts", { count: saved.length });
      } catch (error) {
        await change(() => {
          pending.status = "error";
          data.lastError = String(
            error.message || "Не удалось извлечь знания",
          ).slice(0, 500);
        });
        emit("knowledge-extraction", { state: "error" });
        break;
      }
    }
  }
  function kick() {
    if (!runner)
      runner = run()
        .catch((error) => console.warn("Knowledge extraction:", error.message))
        .finally(() => {
          runner = null;
          if (
            data?.enabled &&
            !forcedOff() &&
            !data.lastError &&
            data.jobs.some((job) => job.status === "waiting")
          )
            kick();
        });
  }
  return {
    async status() {
      await chain;
      await init();
      return {
        enabled: data.enabled && !forcedOff(),
        forcedOff: forcedOff(),
        queued: data.jobs.filter((j) => j.status === "waiting").length,
        running: data.jobs.some((j) => j.status === "running"),
        failed: data.jobs.filter((j) => j.status === "error").length,
        completed: data.jobs.filter((j) => j.status === "done").length,
        lastError: data.lastError,
        lastRun: data.lastRun,
      };
    },
    async configure(enabled) {
      if (typeof enabled !== "boolean")
        throw Object.assign(Error("Укажите, включено ли извлечение знаний"), {
          statusCode: 400,
        });
      await change(() => {
        data.enabled = enabled;
      });
      if (enabled) kick();
      return this.status();
    },
    async enqueue(messages, { retry = false, manual = false } = {}) {
      let added = 0;
      await change(() => {
        if ((!data.enabled || forcedOff()) && !manual) return;
        if (manual && !forcedOff()) data.enabled = true;
        for (const message of messages) {
          if (
            message.role !== "user" ||
            !message.id ||
            !message.content?.trim()
          )
            continue;
          const prior = data.jobs.find((j) => j.id === String(message.id));
          if (prior) {
            if (retry && prior.status === "error") {
              prior.status = "waiting";
              added++;
            }
            continue;
          }
          if (
            data.jobs.filter((j) => ["waiting", "running"].includes(j.status))
              .length >= 30
          )
            break;
          data.jobs.push({
            id: String(message.id),
            text: message.content.slice(0, 4000),
            at: message.at,
            status: "waiting",
          });
          added++;
        }
        const completed = data.jobs
          .filter((j) => j.status === "done")
          .slice(-2000);
        data.jobs = [
          ...completed,
          ...data.jobs.filter((j) => j.status !== "done"),
        ];
      });
      kick();
      return { added, ...(await this.status()) };
    },
    async recent() {
      if (forcedOff())
        throw Object.assign(
          Error(
            "Авторазбор отключён переменной AMAYORI_AUTO_EXTRACT=0. Можно извлечь знания из текста вручную.",
          ),
          { statusCode: 409 },
        );
      const messages = (await history())
        .filter((m) => m.role === "user")
        .slice(-10);
      return this.enqueue(messages, { retry: true, manual: true });
    },
    async resume() {
      kick();
    },
    async wait() {
      await chain;
      if (runner) await runner;
    },
  };
}
