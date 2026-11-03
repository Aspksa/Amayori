(() => {
  "use strict";
  const UI = window.AmayoriUI,
    { api, date, empty, notify } = UI,
    $ = (id) => document.getElementById(id);
  const kindNames = {
    general: "Общее",
    project: "Проект",
    person: "Человек",
    preference: "Предпочтение",
    task: "Задача",
    decision: "Решение",
  };
  const statusNames = {
    active: "Актуально",
    candidate: "Есть расхождение",
    superseded: "В истории",
    merged: "Объединено",
  };
  let request = 0,
    detailRequest = 0,
    selected = null,
    offset = 0,
    total = 0;
  function text(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  }
  function button(label, action, className = "text-button") {
    const node = text("button", label, className);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function sourcesLabel(fact) {
    const sources = fact.sources || [{ kind: fact.source }];
    return sources.some((s) => s.kind === "user-confirmed")
      ? "Подтверждено вами"
      : "Извлечено из переписки";
  }
  async function refreshExtraction() {
    try {
      const data = await api("/api/knowledge/extraction");
      $("knowledge-auto").checked = data.enabled;
      $("knowledge-auto").disabled = data.forcedOff;
      $("knowledge-extraction-status").textContent =
        data.lastError ||
        (data.running
          ? "Извлекаем знания…"
          : data.queued
            ? "В очереди: " + data.queued
            : data.failed
              ? "Не разобрано сообщений: " + data.failed
              : "");
      $("knowledge-extraction-status").dataset.error = String(!!data.lastError);
    } catch (error) {
      $("knowledge-extraction-status").textContent = error.message;
    }
  }
  function filters() {
    return {
      q: $("facts-search").value.trim(),
      topic: $("knowledge-topic-filter").value,
      kind: $("knowledge-kind-filter").value,
      status: $("knowledge-status-filter").value,
    };
  }
  function card(fact) {
    const article = document.createElement("article");
    article.className = "fact-card";
    article.dataset.factId = fact.id;
    const open = button("", () => void showDetail(fact.id), "fact-open");
    open.setAttribute(
      "aria-label",
      "Открыть знание: " + fact.subject + " — " + fact.object,
    );
    const triple = document.createElement("div");
    triple.className = "fact-triple";
    for (const [value, name] of [
      [fact.subject, "subject"],
      [fact.predicate, "predicate"],
      [fact.object, "object"],
    ])
      triple.append(text("span", value, name));
    open.append(triple);
    const meta = document.createElement("div");
    meta.className = "knowledge-card-meta";
    meta.append(
      text("span", fact.topic || "Без темы", "knowledge-topic"),
      text("span", kindNames[fact.kind] || "Общее"),
    );
    if (fact.status && fact.status !== "active")
      meta.append(
        text(
          "span",
          statusNames[fact.status],
          "knowledge-state " + fact.status,
        ),
      );
    open.append(meta);
    const footer = document.createElement("div");
    footer.className = "fact-footer";
    footer.append(
      text(
        "span",
        sourcesLabel(fact) +
          (fact.sources?.length > 1
            ? " · " + fact.sources.length + " источн."
            : ""),
        "source-badge",
      ),
      button("Подробнее", () => void showDetail(fact.id)),
    );
    article.append(open, footer);
    return article;
  }
  async function load(append = false) {
    const ticket = ++request,
      target = $("facts-list");
    if (!append) offset = 0;
    const query = new URLSearchParams({
      ...filters(),
      offset: String(offset),
      limit: "30",
    });
    try {
      const data = await api("/api/knowledge/facts?" + query);
      if (ticket !== request) return;
      if (!append) target.replaceChildren();
      for (const fact of data.facts) target.append(card(fact));
      offset += data.facts.length;
      total = data.total ?? data.facts.length;
      $("knowledge-count").textContent = "Найдено: " + total;
      $("knowledge-more").hidden = offset >= total;
      $("knowledge-more").disabled = false;
      if (!offset)
        target.append(
          empty(
            "Знания пока не найдены",
            "Добавьте карточку или извлеките знания из переписки.",
          ),
        );
      const select = $("knowledge-topic-filter"),
        chosen = select.value;
      select.replaceChildren(new Option("Все темы", ""));
      for (const topic of data.topics || [])
        select.add(new Option(topic, topic));
      if (chosen && ![...select.options].some((o) => o.value === chosen))
        select.add(new Option(chosen, chosen));
      select.value = chosen;
      void refreshExtraction();
    } catch (error) {
      if (ticket === request)
        target.replaceChildren(
          empty("Не удалось загрузить знания", error.message),
        );
    }
  }
  function closeDetail() {
    ++detailRequest;
    selected = null;
    $("knowledge-detail").hidden = true;
    $("knowledge-body").classList.remove("has-selection");
  }
  function section(title, nodes) {
    const block = document.createElement("section");
    block.className = "knowledge-detail-section";
    block.append(text("h3", title), ...nodes);
    return block;
  }
  async function mutate(path, body) {
    await api(path, { method: "POST", body: JSON.stringify(body) });
    await load();
    if (selected) await showDetail(selected);
    document.dispatchEvent(new CustomEvent("amayori-knowledge-updated"));
  }
  function versionRow(fact, { mergeInto = null } = {}) {
    const row = document.createElement("div");
    row.className = "knowledge-version";
    row.append(
      text("p", fact.object),
      text(
        "small",
        (statusNames[fact.status] || "") +
          (date(fact.created_at) ? " · " + date(fact.created_at) : ""),
      ),
    );
    if (mergeInto)
      row.append(
        button("Объединить с этой карточкой", async (event) => {
          const control = event.currentTarget;
          control.disabled = true;
          try {
            await mutate("/api/knowledge/merge", {
              targetId: mergeInto,
              duplicateId: fact.id,
            });
            notify(
              "Источники объединены, прежняя карточка сохранена в истории",
            );
          } catch (error) {
            notify(error.message, "error");
          } finally {
            control.disabled = false;
          }
        }),
      );
    else row.append(button("Открыть карточку", () => void showDetail(fact.id)));
    return row;
  }
  async function showDetail(id) {
    selected = String(id);
    const ticket = ++detailRequest,
      target = $("knowledge-detail-content");
    $("knowledge-detail").hidden = false;
    $("knowledge-body").classList.add("has-selection");
    $("knowledge-detail-title").textContent = "Карточка знания";
    target.replaceChildren(text("p", "Загружаем…", "muted"));
    try {
      const fact = await api(
        "/api/knowledge/card?id=" + encodeURIComponent(id),
      );
      if (ticket !== detailRequest) return;
      target.replaceChildren();
      target.append(
        text("h2", fact.subject),
        text("p", fact.predicate, "knowledge-predicate"),
        text("p", fact.object, "knowledge-value"),
      );
      target.append(
        text(
          "p",
          [
            kindNames[fact.kind] || "Общее",
            ...(fact.topics || [fact.topic || "Без темы"]),
            statusNames[fact.status] || "Актуально",
          ].join(" · "),
          "knowledge-detail-meta",
        ),
      );
      target.append(
        text(
          "p",
          "Добавлено: " +
            date(fact.created_at) +
            (fact.updated_at !== fact.created_at
              ? " · Обновлено: " + date(fact.updated_at)
              : ""),
          "small-text muted",
        ),
      );
      if (
        fact.status === "candidate" ||
        fact.status === "superseded" ||
        fact.conflicts?.length
      ) {
        target.append(
          text(
            "p",
            "Прежнее значение сохранено. Выберите эту версию, только если она теперь актуальна.",
            "field-hint",
          ),
        );
        target.append(
          button(
            "Сделать актуальным",
            async (event) => {
              const control = event.currentTarget;
              control.disabled = true;
              try {
                await mutate("/api/knowledge/choose", { id: fact.id });
                notify("Актуальное знание выбрано. История сохранена");
              } catch (error) {
                notify(error.message, "error");
              } finally {
                control.disabled = false;
              }
            },
            "button subtle",
          ),
        );
      }
      const sourceNodes = (fact.sources || []).map((source) => {
        const block = document.createElement("div");
        block.className = "knowledge-source";
        block.append(
          text(
            "small",
            (source.kind === "user-confirmed"
              ? "Введено вами"
              : source.messageId
                ? "Сообщение пользователя"
                : "Текст для извлечения") +
              " · " +
              date(source.at),
          ),
          text("p", source.excerpt || "Текст источника не сохранён."),
        );
        if (source.messageId && source.excerpt)
          block.append(
            button("Перейти к переписке", () => {
              UI.navigate("chat");
              window.AmayoriChat?.openMessage(source.excerpt);
            }),
          );
        return block;
      });
      target.append(section("Источники · " + sourceNodes.length, sourceNodes));
      if (fact.conflicts?.length)
        target.append(
          section(
            "Другие значения",
            fact.conflicts.map((f) => versionRow(f)),
          ),
        );
      if (
        fact.duplicates?.length &&
        ["active", "candidate"].includes(fact.status)
      )
        target.append(
          section(
            "Похожие карточки — проверьте смысл",
            fact.duplicates.map((f) => versionRow(f, { mergeInto: fact.id })),
          ),
        );
      if (fact.history?.length)
        target.append(
          section(
            "История изменений",
            fact.history.map((f) => versionRow(f)),
          ),
        );
      const related = document.createElement("div");
      related.className = "fact-related";
      for (const f of fact.related || []) {
        const row = button(
          "",
          () => void showDetail(f.id),
          "knowledge-related-link",
        );
        row.append(
          text("span", f.subject + " — " + f.predicate + " — " + f.object),
          text("small", f.relation || "Связанное знание"),
        );
        related.append(row);
      }
      if (!related.childElementCount)
        related.append(text("p", "Других связей пока нет.", "muted"));
      target.append(section("Связанные знания", [related]));
      if (fact.merged_into)
        target.append(
          button(
            "Открыть объединённую карточку",
            () => void showDetail(fact.merged_into),
          ),
        );
    } catch (error) {
      if (ticket === detailRequest)
        target.replaceChildren(empty("Карточка недоступна", error.message));
    }
  }
  $("facts-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    closeDetail();
    void load();
  });
  for (const id of [
    "knowledge-topic-filter",
    "knowledge-kind-filter",
    "knowledge-status-filter",
  ])
    $(id).addEventListener("change", () => {
      closeDetail();
      void load();
    });
  $("knowledge-more").addEventListener("click", () => {
    $("knowledge-more").disabled = true;
    void load(true);
  });
  $("knowledge-detail-close").addEventListener("click", () => {
    const id = selected;
    closeDetail();
    const row = [...document.querySelectorAll("[data-fact-id]")].find(
      (n) => n.dataset.factId === id,
    );
    (row?.querySelector("button") || $("facts-search")).focus();
  });
  $("knowledge-auto").addEventListener("change", async (event) => {
    const enabled = event.target.checked;
    event.target.disabled = true;
    try {
      await api("/api/knowledge/extraction", {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
    } catch (error) {
      notify(error.message, "error");
    } finally {
      event.target.disabled = false;
      void refreshExtraction();
    }
  });
  for (const [buttonId, dialogId] of [
    ["knowledge-add", "knowledge-add-dialog"],
    ["knowledge-extract", "knowledge-extract-dialog"],
  ])
    $(buttonId).addEventListener("click", () => $(dialogId).showModal());
  document
    .querySelectorAll("[data-close-knowledge-dialog]")
    .forEach((node) =>
      node.addEventListener("click", () => node.closest("dialog").close()),
    );
  $("knowledge-add-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    $("knowledge-add-error").textContent = "";
    try {
      const input = Object.fromEntries(new FormData(form));
      input.exclusive = form.elements.exclusive.checked;
      const result = await api("/api/knowledge/facts", {
        method: "POST",
        body: JSON.stringify(input),
      });
      $("knowledge-add-dialog").close();
      form.reset();
      $("knowledge-status-filter").value =
        result.status === "candidate" ? "candidate" : "active";
      $("facts-search").value = "";
      $("knowledge-topic-filter").value = "";
      $("knowledge-kind-filter").value = "";
      await load();
      await showDetail(result.id);
      notify(
        result.merged
          ? "Повтор объединён с существующим знанием"
          : result.status === "candidate"
            ? "Обнаружено расхождение. Выберите актуальную версию"
            : "Знание сохранено",
      );
    } catch (error) {
      $("knowledge-add-error").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  $("knowledge-extract-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("[type=submit]");
    submit.disabled = true;
    $("knowledge-extract-error").textContent = "Извлекаем знания…";
    try {
      const result = await api("/api/knowledge/extract", {
        method: "POST",
        body: JSON.stringify({ text: $("knowledge-extract-text").value }),
      });
      $("knowledge-extract-error").textContent =
        "Обработано знаний: " + result.facts.length;
      $("knowledge-status-filter").value = "all";
      await load();
      notify(
        result.facts.length
          ? "Знания извлечены. Повторы объединены"
          : "Явных долговременных сведений не найдено",
      );
    } catch (error) {
      $("knowledge-extract-error").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  $("knowledge-extract-recent").addEventListener("click", async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    try {
      const result = await api("/api/knowledge/extract-recent", {
        method: "POST",
        body: "{}",
      });
      notify(
        result.added
          ? "В очередь добавлено сообщений: " + result.added
          : "Новых сообщений для разбора нет",
      );
      $("knowledge-extract-dialog").close();
      void refreshExtraction();
    } catch (error) {
      $("knowledge-extract-error").textContent = error.message;
    } finally {
      control.disabled = false;
    }
  });
  let lastStatus = "";
  setInterval(() => {
    if (
      document.hidden ||
      UI.state?.page !== "memory" ||
      UI.state.tab !== "facts"
    )
      return;
    void api("/api/knowledge/extraction")
      .then((data) => {
        const next = JSON.stringify([
          data.completed,
          data.failed,
          data.running,
          data.queued,
        ]);
        if (next !== lastStatus) {
          lastStatus = next;
          void load();
          if (selected) void showDetail(selected);
        } else void refreshExtraction();
      })
      .catch(() => {});
  }, 4000);
  document.addEventListener("amayori-chat-updated", () => {
    if (UI.state?.tab === "facts") void load();
  });
  UI.knowledge = { load, showDetail };
})();
