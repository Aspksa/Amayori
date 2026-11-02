(() => {
  "use strict";
  const UI = window.AmayoriUI,
    { api, icon, notify, empty, mark, preview, date } = UI;
  const $ = (id) => document.getElementById(id);
  const titles = {
    chat: "Диалог",
    memory: "Память",
    graph: "Карта знаний",
    settings: "Настройки",
  };
  const groups = {
    memory: ["archive", "facts", "quality"],
    settings: ["connection", "appearance", "brain"],
  };
  const state = (UI.state = {
    page: "chat",
    settings: { hasKey: false, model: "" },
    messages: 0,
    database: false,
  });
  let archive = [],
    archiveLoaded = false,
    modelRequest = null;
  UI.isViewVisible = (page) =>
    (state.visiblePages || [state.page]).includes(page);
  function renderWorkspace(page, tab, rememberContext = false) {
    const layout = UI.workspace.apply(page, tab, rememberContext);
    state.visiblePages = layout.visiblePages;
    state.split = layout.split;
    document.documentElement.dataset.page = page;
    document
      .querySelectorAll("#workspace > [data-view]")
      .forEach(
        (view) =>
          (view.hidden = !layout.visiblePages.includes(view.dataset.view)),
      );
    document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
      if (link.dataset.page === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    for (const [name, tabs] of Object.entries(groups)) {
      const current =
        name === "memory" && layout.split && layout.content === "archive"
          ? "archive"
          : name === page
            ? tab
            : tabs.find(
                (t) => $("tab-" + t).getAttribute("aria-selected") === "true",
              ) || tabs[0];
      for (const t of tabs) {
        const active = t === current;
        $("tab-" + t).setAttribute("aria-selected", String(active));
        $("tab-" + t).tabIndex = active ? 0 : -1;
        $(name + "-" + t).hidden = !active;
      }
    }
    document.dispatchEvent(
      new CustomEvent("amayori-view", { detail: { page, tab, ...layout } }),
    );
  }
  function refreshVisibleMemory() {
    if (!UI.isViewVisible("memory")) return;
    void refreshMemory();
    if (!$("memory-archive").hidden) void loadArchive();
    if (!$("memory-facts").hidden) void loadFacts();
    if (!$("memory-quality").hidden) void loadQuality();
  }
  function navigate() {
    const parts = location.hash.slice(1).split("/");
    const page = Object.hasOwn(titles, parts[0]) ? parts[0] : "chat";
    const tab = groups[page]?.includes(parts[1]) ? parts[1] : groups[page]?.[0];
    state.page = page;
    state.tab = tab;
    renderWorkspace(page, tab, true);
    $("view-title").textContent = titles[page];
    document.title = titles[page] + " · Amayori";
    refreshVisibleMemory();
  }
  UI.refreshWorkspace = () => {
    renderWorkspace(state.page, state.tab);
    refreshVisibleMemory();
  };
  UI.navigate = (page, tab) => {
    const target = "#" + page + (tab ? "/" + tab : "");
    if (location.hash === target) navigate();
    else location.hash = target;
  };
  addEventListener("hashchange", navigate);
  navigate();
  document.querySelectorAll("[role=tablist]").forEach((list) =>
    list.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      const tabs = [...list.querySelectorAll("[role=tab]")],
        index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      tabs[next].focus();
      tabs[next].click();
    }),
  );
  function archiveSearch() {
    UI.navigate("memory", "archive");
    requestAnimationFrame(() => $("archive-search").focus());
  }
  $("global-search").addEventListener("click", archiveSearch);
  addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      archiveSearch();
    }
  });
  function connection(stateName, label) {
    const badge = $("connection-badge");
    badge.dataset.state = stateName;
    badge.setAttribute("aria-label", label + " · настройки подключения");
    badge.title = label;
    badge.lastElementChild.textContent = label;
  }
  function publishConfig() {
    document.dispatchEvent(
      new CustomEvent("amayori-config", { detail: state.settings }),
    );
    connection(
      state.settings.hasKey
        ? state.settings.model
          ? "saved"
          : "idle"
        : "idle",
      state.settings.hasKey
        ? state.settings.model
          ? "Модель выбрана"
          : "Выберите модель"
        : "Без подключения",
    );
  }
  async function loadConfig() {
    try {
      state.settings = await api("/api/settings");
      $("model").value = state.settings.model || "";
      $("key-state").textContent = state.settings.hasKey
        ? "Ключ сохранён. Оставьте поле пустым, чтобы сохранить его."
        : "Ключ будет сохранён только на этом компьютере.";
      $("api-key").placeholder = state.settings.hasKey
        ? "Ключ сохранён"
        : "Введите ключ";
      publishConfig();
      if (state.settings.hasKey) void loadModels(false);
    } catch (error) {
      connection("idle", "Нет связи");
      $("app-status").textContent = error.message;
    }
  }
  async function saveSettings(quiet = false) {
    const data = {
      model: $("model").value.trim(),
      apiKey: $("api-key").value,
      endpoint: "https://foundation-models.api.cloud.ru/v1/chat/completions",
    };
    await api("/api/settings", { method: "POST", body: JSON.stringify(data) });
    state.settings = {
      ...state.settings,
      model: data.model,
      hasKey: !!data.apiKey.trim() || state.settings.hasKey,
    };
    $("api-key").value = "";
    $("api-key").type = "password";
    $("toggle-key").innerHTML = icon("eye");
    $("toggle-key").setAttribute("aria-label", "Показать ключ");
    $("key-state").textContent = state.settings.hasKey
      ? "Ключ сохранён на компьютере."
      : "Ключ ещё не задан.";
    $("api-key").placeholder = state.settings.hasKey
      ? "Ключ сохранён"
      : "Введите ключ";
    publishConfig();
    if (!quiet) $("app-status").textContent = "Настройки сохранены";
  }
  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await saveSettings();
      notify("Подключение сохранено");
    } catch (error) {
      $("app-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $("toggle-key").addEventListener("click", () => {
    const show = $("api-key").type === "password";
    $("api-key").type = show ? "text" : "password";
    $("toggle-key").innerHTML = icon(show ? "eye-off" : "eye");
    $("toggle-key").setAttribute(
      "aria-label",
      show ? "Скрыть ключ" : "Показать ключ",
    );
  });
  async function loadModels(saveKey = true) {
    if (modelRequest) return modelRequest;
    const button = $("load-models");
    button.disabled = true;
    $("models-status").textContent = "Загружаем доступные модели…";
    modelRequest = (async () => {
      try {
        if (saveKey && $("api-key").value.trim()) await saveSettings(true);
        const data = await api("/api/models"),
          models = data.models.filter(
            (m) =>
              !m.type ||
              m.type === "unknown" ||
              /llm|chat|text.generation/i.test(m.type),
          );
        const unique = [
          ...new Map(models.map((model) => [model.id, model])).values(),
        ];
        $("available-models").replaceChildren();
        for (const model of unique) {
          const option = document.createElement("option");
          option.value = model.id;
          option.label = model.name;
          $("available-models").append(option);
        }
        $("models-status").textContent = unique.length
          ? "Доступно моделей: " + unique.length
          : "В этом списке нет моделей для чата. Можно ввести ID вручную.";
        UI.models = unique;
        document.dispatchEvent(
          new CustomEvent("amayori-models", { detail: unique }),
        );
      } catch (error) {
        $("models-status").textContent =
          error.message + ". ID модели можно ввести вручную.";
      } finally {
        button.disabled = false;
        modelRequest = null;
      }
    })();
    return modelRequest;
  }
  $("load-models").addEventListener("click", () => void loadModels());
  $("test-connection").addEventListener("click", async () => {
    if (!$("model").reportValidity()) return;
    const button = $("test-connection");
    button.disabled = true;
    $("app-status").textContent = "Проверяем ответ модели…";
    try {
      await saveSettings(true);
      await api("/api/test-connection", { method: "POST", body: "{}" });
      connection("ready", "Подключено");
      $("app-status").textContent = "Модель отвечает. Можно начать диалог.";
      notify("Связь с моделью проверена");
    } catch (error) {
      connection("idle", "Ошибка связи");
      $("app-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  async function refreshMemory() {
    const results = await Promise.allSettled([
      api("/api/memory/status"),
      api("/api/golem/embedding-status"),
      api("/api/database/status"),
    ]);
    if (results[0].status === "fulfilled") {
      const value = results[0].value;
      state.messages = value.messages;
      state.database = value.mode === "postgresql";
      $("memory-count").textContent = value.messages.toLocaleString("ru-RU");
      $("memory-engine").textContent = state.database
        ? "PostgreSQL"
        : "Локальный архив";
      $("memory-storage-hint").textContent = state.database
        ? "Основная база"
        : "На этом компьютере";
    } else {
      $("memory-count").textContent = "—";
      $("memory-storage-hint").textContent = "Хранилище недоступно";
    }
    if (results[1].status === "fulfilled") {
      const value = results[1].value;
      state.semanticReady = state.database && value.configured;
      $("golem-index-batch").hidden = !state.semanticReady;
      $("golem-similar").hidden = !state.semanticReady;
      $("memory-indexed").dataset.kind = value.configured ? "number" : "label";
      $("memory-indexed").textContent = value.configured
        ? Number(value.indexed || 0).toLocaleString("ru-RU")
        : "Не настроен";
      $("memory-index-hint").textContent = value.configured
        ? "из " +
          Number(value.total || 0).toLocaleString("ru-RU") +
          " сообщений"
        : "Доступен поиск по словам";
    } else {
      $("memory-indexed").dataset.kind = "label";
      $("golem-index-batch").hidden = true;
      $("golem-similar").hidden = true;
      $("memory-indexed").textContent = "Недоступен";
      $("memory-index-hint").textContent = "Доступен поиск по словам";
    }
    if (results[2].status === "fulfilled") {
      const db = results[2].value;
      $("database-state").textContent = db.connected
        ? "PostgreSQL подключён"
        : db.enabled
          ? "База сейчас недоступна"
          : "Работает локальный архив";
    } else $("database-state").textContent = "Состояние базы недоступно";
  }
  async function loadArchive() {
    try {
      const data = await api("/api/chats");
      archive = Array.isArray(data.messages) ? data.messages : [];
      archiveLoaded = true;
      renderArchive();
    } catch (error) {
      $("archive-list").replaceChildren(
        empty("Не удалось открыть архив", error.message),
      );
    }
  }
  function renderArchive() {
    const query = $("archive-search").value.trim(),
      lower = query.toLocaleLowerCase("ru");
    const items = archive.filter((item) =>
      item.content.toLocaleLowerCase("ru").includes(lower),
    );
    const list = $("archive-list");
    list.replaceChildren();
    $("archive-summary").textContent = query
      ? "Найдено: " + items.length
      : state.messages > archive.length
        ? "Последние " + archive.length + " из " + state.messages
        : "";
    if (!items.length) {
      list.append(
        empty(
          query ? "Ничего не найдено" : "Здесь будет ваша история",
          query
            ? "Попробуйте другое слово."
            : "Начните диалог — переписка сохранится в архиве.",
        ),
      );
      return;
    }
    for (const item of [...items].reverse()) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "archive-item " + item.role;
      const role = document.createElement("span");
      role.className = "archive-role";
      role.innerHTML = item.role === "assistant" ? icon("fox") : icon("note");
      const content = document.createElement("span");
      content.className = "archive-text";
      const text = document.createElement("p"),
        meta = document.createElement("small");
      text.append(mark(preview(item.content), query));
      meta.textContent =
        (item.role === "user" ? "Вы" : "Ответ") +
        (date(item.at) ? " · " + date(item.at) : "");
      content.append(text, meta);
      row.append(role, content);
      const chevron = document.createElement("span");
      chevron.className = "archive-chevron";
      chevron.innerHTML = icon("chevron");
      row.append(chevron);
      row.addEventListener("click", () => {
        UI.navigate("chat");
        window.AmayoriChat?.openMessage(item.content);
      });
      list.append(row);
    }
  }
  $("archive-search").addEventListener("input", () => {
    if (archiveLoaded) renderArchive();
  });
  async function loadFacts() {
    const target = $("facts-list");
    try {
      const data = await api(
        "/api/knowledge/facts?q=" +
          encodeURIComponent($("facts-search").value.trim()),
      );
      target.replaceChildren();
      if (!data.facts.length) {
        target.append(
          empty(
            "Знания пока не найдены",
            state.database
              ? "Факты появятся после извлечения знаний из переписки."
              : "Для структурированных знаний подключите PostgreSQL. Архив диалогов уже доступен.",
          ),
        );
        return;
      }
      for (const fact of data.facts) {
        const card = document.createElement("article");
        card.className = "fact-card";
        const triple = document.createElement("div");
        triple.className = "fact-triple";
        for (const [value, name] of [
          [fact.subject, "subject"],
          [fact.predicate, "predicate"],
          [fact.object, "object"],
        ]) {
          const span = document.createElement("span");
          span.className = name;
          span.textContent = value;
          triple.append(span);
        }
        const footer = document.createElement("div");
        footer.className = "fact-footer";
        const source = document.createElement("span");
        source.className = "source-badge";
        source.textContent =
          (fact.source === "user-confirmed"
            ? "Подтверждено вами"
            : fact.source === "cloudru-extracted"
              ? "Извлечено ИИ"
              : "Из памяти") +
          " · №" +
          fact.id;
        const related = document.createElement("button");
        related.type = "button";
        related.className = "text-button";
        related.textContent = "Связанные знания";
        related.addEventListener("click", async () => {
          related.disabled = true;
          let box = card.querySelector(".fact-related");
          if (!box) {
            box = document.createElement("div");
            box.className = "fact-related";
            card.append(box);
          }
          try {
            const response = await api(
              "/api/knowledge/related?id=" + encodeURIComponent(fact.id),
            );
            box.replaceChildren();
            if (!response.facts.length)
              box.textContent = "Других связей пока нет.";
            for (const f of response.facts) {
              const p = document.createElement("p");
              p.textContent =
                f.subject + " — " + f.predicate + " — " + f.object;
              box.append(p);
            }
          } catch (error) {
            box.textContent = error.message;
          } finally {
            related.disabled = false;
          }
        });
        footer.append(source, related);
        card.append(triple, footer);
        target.append(card);
      }
    } catch (error) {
      target.replaceChildren(
        empty("Не удалось загрузить знания", error.message),
      );
    }
  }
  $("facts-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void loadFacts();
  });
  function qualityDetails(title, rows, format) {
    const details = document.createElement("details");
    details.className = "quality-details";
    const summary = document.createElement("summary");
    summary.textContent = title + " · " + rows.length;
    details.append(summary);
    const list = document.createElement("ul");
    for (const row of rows) {
      const li = document.createElement("li");
      li.textContent = format(row);
      list.append(li);
    }
    if (!rows.length) {
      const li = document.createElement("li");
      li.textContent = "Записей пока нет.";
      list.append(li);
    }
    details.append(list);
    return details;
  }
  async function loadQuality() {
    const target = $("quality-results"),
      button = $("refresh-quality");
    button.disabled = true;
    try {
      const [immunity, conflicts, bridges, traces] = await Promise.all([
        api("/api/golem/immunity"),
        api("/api/knowledge/conflicts"),
        api("/api/golem/bridges"),
        api("/api/golem/traces"),
      ]);
      target.replaceChildren();
      const grid = document.createElement("div");
      grid.className = "quality-grid";
      for (const [title, count, hint] of [
        [
          "Версии фактов",
          conflicts.conflicts.length,
          "Прежние значения сохранены",
        ],
        ["Повторы", immunity.duplicates.length, "Одинаковые активные факты"],
        [
          "Ждут проверки",
          immunity.unverified.length,
          "Извлечённые автоматически",
        ],
      ]) {
        const card = document.createElement("article");
        card.className = "quality-card";
        const h = document.createElement("h3"),
          n = document.createElement("strong"),
          p = document.createElement("p");
        h.textContent = title;
        n.textContent = count;
        p.textContent = hint;
        card.append(h, n, p);
        grid.append(card);
      }
      target.append(
        grid,
        qualityDetails(
          "Изменённые факты",
          conflicts.conflicts,
          (x) =>
            x.subject +
            " · " +
            x.predicate +
            ": «" +
            x.previous +
            "» → «" +
            x.current +
            "»",
        ),
        qualityDetails(
          "Повторы и расхождения",
          [...immunity.duplicates, ...immunity.conflicts],
          (x) =>
            x.subject +
            " — " +
            x.predicate +
            (x.object ? " — " + x.object : "") +
            " · " +
            (x.copies ? "копий: " + x.copies : "значений: " + x.variants),
        ),
        qualityDetails(
          "Непроверенные факты",
          immunity.unverified,
          (x) => x.subject + " — " + x.predicate + " — " + x.object,
        ),
        qualityDetails(
          "Связи между знаниями",
          bridges.suggestions,
          (x) =>
            x.first_subject +
            " ↔ " +
            x.second_subject +
            " · общее: " +
            x.shared_entity,
        ),
        qualityDetails(
          "Источники ответов",
          traces.traces,
          (x) =>
            x.question + " · фактов использовано: " + (x.fact_ids?.length || 0),
        ),
      );
    } catch (error) {
      target.replaceChildren(empty("Проверка недоступна", error.message));
    } finally {
      button.disabled = false;
    }
  }
  $("refresh-quality").addEventListener("click", () => void loadQuality());
  $("golem-index-batch").addEventListener("click", async () => {
    const button = $("golem-index-batch");
    button.disabled = true;
    $("golem-index-status").textContent = "Обновляем индекс…";
    try {
      const result = await api("/api/golem/index-batch", {
        method: "POST",
        body: "{}",
      });
      $("golem-index-status").textContent =
        result.configured === false
          ? "Для поиска по смыслу настройте модель эмбеддингов Cloud.ru."
          : result.busy
            ? "Индексация уже идёт."
            : "В индексе " +
              result.indexed +
              " из " +
              result.total +
              " сообщений.";
      await refreshMemory();
    } catch (error) {
      $("golem-index-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  const prefs = { density: "comfortable", labels: false, motion: true };
  try {
    const saved = JSON.parse(localStorage.getItem("amayori-appearance"));
    if (saved) {
      if (["compact", "comfortable"].includes(saved.density))
        prefs.density = saved.density;
      if (typeof saved.labels === "boolean") prefs.labels = saved.labels;
      if (typeof saved.motion === "boolean") prefs.motion = saved.motion;
    }
  } catch {}
  function appearance(save = false) {
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.dataset.menuLabels = String(prefs.labels);
    document.documentElement.dataset.motion = String(prefs.motion);
    $("interface-density").value = prefs.density;
    $("menu-labels").checked = prefs.labels;
    $("interface-motion").checked = prefs.motion;
    if (save)
      try {
        localStorage.setItem("amayori-appearance", JSON.stringify(prefs));
      } catch {
        notify("Браузер не разрешил сохранить внешний вид", "error");
      }
    document.dispatchEvent(new Event("amayori-layout"));
  }
  appearance();
  $("interface-density").addEventListener("change", (event) => {
    prefs.density = event.target.value;
    appearance(true);
  });
  $("menu-labels").addEventListener("change", (event) => {
    prefs.labels = event.target.checked;
    appearance(true);
  });
  $("interface-motion").addEventListener("change", (event) => {
    prefs.motion = event.target.checked;
    appearance(true);
  });
  $("reset-avatar-position").addEventListener("click", () => {
    document.dispatchEvent(new Event("amayori-avatar-reset"));
    notify("Аватар возвращён на место");
  });
  $("golem-settings-size").addEventListener(
    "input",
    (event) => ($("node-size-value").value = event.target.value),
  );
  api("/api/golem/settings")
    .then((value) => {
      $("golem-auto-rotate").checked = value.autoRotate;
      $("golem-settings-size").value = value.nodeSize;
      $("node-size-value").value = value.nodeSize;
    })
    .catch((error) => ($("golem-settings-status").textContent = error.message));
  $("golem-settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await api("/api/golem/settings", {
        method: "POST",
        body: JSON.stringify({
          defaultView: "original",
          autoRotate: $("golem-auto-rotate").checked,
          nodeSize: Number($("golem-settings-size").value),
        }),
      });
      $("golem-settings-status").textContent =
        "Открытое окно Голема применит настройки в течение 12 секунд.";
      notify("Настройки карты сохранены");
    } catch (error) {
      $("golem-settings-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  async function buildStatus() {
    try {
      const value = await api("/api/golem/build-status");
      const labels = {
        idle: "Ожидает переписки",
        building: "Обновляется в фоне",
        ready: "Карта готова",
        error: "Построение не завершено",
      };
      $("golem-build-status").textContent =
        (labels[value.state] || "Состояние неизвестно") +
        (value.nodes
          ? " · " + Number(value.nodes).toLocaleString("ru-RU") + " узлов"
          : "");
      $("golem-build-status").title = value.error || "";
    } catch {
      $("golem-build-status").textContent = "Нет связи с сервером";
    }
  }
  document.addEventListener("amayori-chat-success", () =>
    connection("ready", "Подключено"),
  );
  document.addEventListener("amayori-chat-updated", () => {
    void refreshMemory();
    if (UI.isViewVisible("memory")) {
      void loadArchive();
      if (!$("memory-facts").hidden) void loadFacts();
    }
  });
  addEventListener("storage", (event) => {
    if (event.key === "amayori-chat-update") {
      void refreshMemory();
      if (UI.isViewVisible("memory")) void loadArchive();
    }
  });
  void loadConfig();
  void refreshMemory();
  void buildStatus();
  setInterval(() => {
    if (!document.hidden && (state.page !== "chat" || state.split)) {
      void refreshMemory();
      if (state.page === "settings") void buildStatus();
    }
  }, 15000);
})();
