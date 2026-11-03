(() => {
  "use strict";
  const UI = window.AmayoriUI,
    { api, icon, empty, date, notify, preview } = UI,
    $ = (id) => document.getElementById(id);
  const dialog = $("topic-window");
  const pendingRetries = new Set();
  const navigation = window.AmayoriTopicNavigation;
  const preferencesKey = "amayori-topic-navigation";
  let preferences = navigation.normalize(null), folderFingerprint = "";
  try { preferences = navigation.normalize(JSON.parse(localStorage.getItem(preferencesKey))); } catch {}
  let overview = { folders: [], roots: [], total: 0 },
    selectedTopic = "",
    mode = "knowledge",
    overviewRequest = 0,
    conversationRequest = 0,
    archiveRequest = 0;
  let conversationOffset = 0,
    archiveOffset = 0,
    reading = null,
    searchTimer,
    conversationSearchTimer;
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const action = (label, fn, className = "text-button") => {
    const node = text("button", label, className);
    node.type = "button";
    node.addEventListener("click", fn);
    return node;
  };
  const quantity = (count, forms) => {
    const last = count % 10, tail = count % 100;
    return count + " " + forms[tail >= 11 && tail <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2];
  };
  const currentFolder = () =>
    overview.folders.find((folder) => folder.path === selectedTopic);
  function folderButton(folder) {
    const shell = document.createElement("article");
    shell.className = "topic-folder-shell";
    const button = action("", () => void open(folder.path), "topic-folder");
    button.dataset.topicPath = folder.path;
    const symbol = document.createElement("span");
    symbol.className = "topic-folder-icon";
    symbol.innerHTML = icon("archive");
    const content = document.createElement("span");
    content.className = "topic-folder-copy";
    content.append(
      text("strong", folder.name),
      text(
        "small",
        quantity(folder.count, ["знание", "знания", "знаний"]) + (folder.conversations ? " · " + quantity(folder.conversations, ["беседа", "беседы", "бесед"]) : ""),
      ),
    );
    if (folder.matchedChildren.length) {
      const names = folder.matchedChildren.map(path => path.split(" / ").at(-1));
      content.append(text("span", "Подтемы: " + names.slice(0, 2).join(", ") + (names.length > 2 ? "…" : ""), "topic-folder-match"));
    }
    button.append(symbol, content);
    if (folder.attention) {
      const marker = text(
        "span",
        String(folder.attention),
        "topic-attention-marker",
      );
      marker.setAttribute(
        "aria-label",
        "Требует внимания: " + folder.attention,
      );
      button.append(marker);
    }
    button.setAttribute(
      "aria-label",
      "Открыть папку " +
        folder.path +
        (folder.attention ? ", требует внимания: " + folder.attention : ""),
    );
    const pin = action("", () => {
      const next = navigation.toggle(preferences, folder.path);
      if (!folder.pinned && !navigation.isPinned(next, folder.path)) {
        notify("Можно закрепить до 200 папок");
        return;
      }
      preferences = next;
      try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); }
      catch { notify("Закрепление сохранится до закрытия этой страницы"); }
      renderFolders();
    }, "icon-button topic-folder-pin");
    pin.dataset.pinPath = folder.path;
    pin.innerHTML = icon("pin");
    pin.setAttribute("aria-pressed", String(folder.pinned));
    pin.setAttribute("aria-label", (folder.pinned ? "Открепить папку " : "Закрепить папку ") + folder.path);
    pin.title = folder.pinned ? "Открепить" : "Закрепить";
    shell.append(button, pin);
    return shell;
  }
  function renderFolders({resetScroll = false} = {}) {
    const query = $("topic-folder-search").value;
    const filter = $("topic-folder-filter").value;
    const view = navigation.select(overview, {query, filter, prefs:preferences});
    $("topic-folder-tools").hidden = !overview.roots.length && !query && filter === "all";
    for (const [value, label] of [["all", "Все темы"], ["pinned", "Закреплённые"], ["attention", "Требуют внимания"]]) {
      $("topic-folder-filter").querySelector('option[value="' + value + '"]').textContent = label + " · " + view.counts[value];
    }
    const status = $("topic-folder-results");
    status.hidden = !query.trim() && filter === "all";
    status.textContent = "Показано папок: " + view.rows.length + " из " + view.counts.all;
    const fingerprint = JSON.stringify([view.rows.map(folder => [folder.path, folder.name, folder.count, folder.conversations, folder.attention, folder.pinned, folder.matchedChildren]), query, filter]);
    const target = $("topic-folders");
    if (resetScroll) target.scrollTop = 0;
    if (fingerprint === folderFingerprint) return;
    folderFingerprint = fingerprint;
    const active = document.activeElement;
    const focusedPin = active?.dataset.pinPath, focusedFolder = active?.dataset.topicPath;
    const scroll = target.scrollTop;
    target.replaceChildren(...view.rows.map(folderButton));
    if (!view.rows.length) {
      const noFolders = !overview.roots.length;
      const title = noFolders ? "Здесь появятся темы памяти" : query.trim() ? "Папки не найдены" : filter === "pinned" ? "Важные темы под рукой" : "Всё разобрано";
      const hint = noFolders ? "Добавьте знание или извлеките сведения из переписки." : query.trim() ? "Попробуйте название папки или её подтемы." : filter === "pinned" ? "Закрепите нужные папки значком булавки." : "В папках нет вопросов, требующих решения.";
      const state = empty(title, hint);
      if (!noFolders) state.append(action(query.trim() ? "Сбросить поиск и фильтр" : "Показать все темы", () => {
        $("topic-folder-search").value = "";
        $("topic-folder-filter").value = "all";
        renderFolders({resetScroll:true});
        $("topic-folder-search").focus();
      }));
      target.append(state);
    }
    target.scrollTop = scroll;
    if (focusedPin || focusedFolder) {
      const controls = target.querySelectorAll(focusedPin ? "[data-pin-path]" : "[data-topic-path]");
      const replacement = [...controls].find(node => focusedPin ? node.dataset.pinPath === focusedPin : node.dataset.topicPath === focusedFolder);
      (replacement || $("topic-folder-filter")).focus({preventScroll:true});
    }
  }
  function headings() {
    const folder = currentFolder();
    $("topic-conversation-search").placeholder = selectedTopic ? "Найти в беседах папки" : "Найти в беседах";
    $("topic-conversation-search").setAttribute("aria-label", selectedTopic ? "Поиск по беседам папки" : "Поиск по беседам");
    $("topic-window-title").textContent = selectedTopic
      ? folder?.name || selectedTopic.split(" / ").at(-1)
      : "Беседы";
    $("topic-parent").hidden = !selectedTopic;
    $("topic-parent").textContent = selectedTopic.includes(" / ")
      ? selectedTopic.split(" / ")[0]
      : "Все темы";
    $("topic-knowledge-count").textContent = folder ? String(folder.count) : "";
    $("topic-conversation-count").textContent = folder
      ? String(folder.conversations)
      : "";
    $("topic-attention-count").textContent = folder?.attention
      ? String(folder.attention)
      : "";
    $("topic-tab-attention").hidden = !folder?.attention;
    const children = $("topic-children");
    children.replaceChildren();
    for (const path of folder?.children || [])
      children.append(
        action(path.split(" / ").at(-1), () => void open(path), "topic-child"),
      );
    children.hidden = !children.childElementCount;
  }
  async function load() {
    const ticket = ++overviewRequest;
    try {
      const data = await api("/api/knowledge/folders");
      if (ticket !== overviewRequest) return;
      overview = data;
      $("knowledge-count").textContent =
        quantity(data.total, ["знание", "знания", "знаний"]) + " · " + quantity(data.roots.length, ["тема", "темы", "тем"]);
      renderFolders();
      if (dialog.open) {
        headings();
        if (mode === "attention") renderAttention();
      }
      void UI.knowledge.refreshExtraction();
    } catch (error) {
      if (ticket === overviewRequest) {
        folderFingerprint = "";
        $("topic-folders").replaceChildren(
          empty("Не удалось открыть темы", error.message),
        );
      }
    }
  }
  function chooseMode(value) {
    if (value !== "conversations") clearTimeout(conversationSearchTimer);
    mode = value;
    if (!selectedTopic)
      $("topic-window-title").textContent =
        value === "knowledge" ? "Все знания" : "Беседы";
    for (const name of ["knowledge", "conversations", "attention"]) {
      $("topic-panel-" + name).hidden = name !== value;
      $("topic-tab-" + name).setAttribute(
        "aria-pressed",
        String(name === value),
      );
    }
    $("topic-window-status").textContent = "";
  }
  async function open(path) {
    clearTimeout(conversationSearchTimer);
    $("topic-conversation-search").value = "";
    selectedTopic = path;
    reading = null;
    ++conversationRequest;
    UI.knowledge.closeDetail();
    const select = $("knowledge-topic-filter");
    if (path && ![...select.options].some((option) => option.value === path))
      select.add(new Option(path, path));
    select.value = path;
    $("facts-search").value = "";
    $("knowledge-kind-filter").value = "";
    const folder = currentFolder();
    $("knowledge-status-filter").value =
      folder?.count && !folder.active ? "all" : "active";
    headings();
    chooseMode("knowledge");
    if (!dialog.open) dialog.showModal();
    await UI.knowledge.load();
  }
  function close() {
    dialog.close();
  }
  function renderAttention() {
    const panel = $("topic-panel-attention");
    panel.replaceChildren();
    const issues = currentFolder()?.issues || [];
    if (!issues.length) {
      panel.append(
        empty("Всё разобрано", "В этой теме нет вопросов, требующих решения."),
      );
      return;
    }
    for (const issue of issues) {
      const card = document.createElement("article");
      card.className = "topic-issue";
      card.append(text("h3", issue.label));
      if (issue.factId)
        card.append(
          action("Открыть знание", async () => {
            chooseMode("knowledge");
            $("knowledge-status-filter").value = "all";
            await UI.knowledge.load();
            await UI.knowledge.showDetail(issue.factId);
          }),
        );
      else if (issue.type === "similar-topics") {
        card.append(
          text("p", issue.from + " → " + issue.to, "muted small-text"),
          text(
            "p",
            "Источники, карточки и прежние версии сохранятся. Новые сведения с прежним названием будут попадать в объединённую тему.",
            "field-hint",
          ),
        );
        card.append(
          action(
            "Объединить в «" + issue.to + "»",
            async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                await api("/api/knowledge/topics/merge", {
                  method: "POST",
                  body: JSON.stringify({ from: issue.from, to: issue.to }),
                });
                const old = selectedTopic;
                await load();
                await open(old === issue.from ? issue.to : old);
                notify("Темы объединены. Источники сохранены");
              } catch (error) {
                $("topic-window-status").textContent = error.message;
              } finally {
                button.disabled = false;
              }
            },
            "button subtle",
          ),
        );
      } else if (issue.type === "extraction") {
        card.append(
          text(
            "p",
            "Сообщение осталось в архиве. Повторный разбор — дополнительный запрос Cloud.ru.",
            "field-hint",
          ),
        );
        const retryButton = action(
            pendingRetries.has(issue.messageId) ? "Разбираем…" : "Повторить разбор сообщения",
            async (event) => {
              if (pendingRetries.has(issue.messageId)) return;
              pendingRetries.add(issue.messageId);
              const button = event.currentTarget;
              button.disabled = true;
              button.textContent = "Разбираем…";
              try {
                await api("/api/knowledge/extract", {
                  method: "POST",
                  body: JSON.stringify({ sourceMessageId: issue.messageId }),
                });
                await load();
                renderAttention();
                notify("Сообщение разобрано");
              } catch (error) {
                $("topic-window-status").textContent = error.message;
              } finally {
                pendingRetries.delete(issue.messageId);
                if (dialog.open && mode === "attention") renderAttention();
              }
            },
            "button subtle",
          );
        retryButton.dataset.retryMessageId = issue.messageId;
        retryButton.disabled = pendingRetries.has(issue.messageId);
        card.append(retryButton);
      }
      panel.append(card);
    }
  }
  function conversationRow(conversation, { archive = false } = {}) {
    const query = archive ? $("archive-search").value : $("topic-conversation-search").value;
    const row = action(
      "",
      () =>
        void openConversation(conversation.id, {
          topic: archive ? "" : selectedTopic,
          messageId: conversation.matchMessageId,
        }),
      "archive-item conversation-item",
    );
    row.dataset.conversationId = conversation.id;
    const symbol = document.createElement("span");
    symbol.className = "archive-role";
    symbol.innerHTML = icon("chat");
    const content = document.createElement("span");
    content.className = "archive-text";
    const title = text("p", "");
    title.append(
      UI.mark(conversation.title, query),
    );
    content.append(
      title,
      text(
        "small",
        quantity(conversation.messages, ["сообщение", "сообщения", "сообщений"]) +
          (date(conversation.endedAt)
            ? " · " + date(conversation.endedAt)
            : ""),
      ),
    );
    if (conversation.snippet) {
      const snippet = text("span", "", "conversation-match");
      snippet.append(UI.mark(conversation.snippet, query));
      content.append(snippet);
    }
    row.append(symbol, content);
    return row;
  }
  async function loadConversations(append = false) {
    const ticket = ++conversationRequest;
    const query = $("topic-conversation-search").value.trim();
    const more = $("topic-conversation-more");
    more.disabled = true;
    if (!append) {
      conversationOffset = 0;
      more.hidden = true;
      $("topic-conversation-results").textContent = "";
    }
    reading = null;
    $("topic-conversation-tools").hidden = false;
    $("topic-conversation-reader").hidden = true;
    $("topic-conversation-list").hidden = false;
    try {
      const data = await api(
        "/api/conversations/grouped?" +
          new URLSearchParams({
            topic: selectedTopic,
            q: query,
            offset: String(conversationOffset),
            limit: "30",
          }),
      );
      if (
        ticket !== conversationRequest ||
        !dialog.open ||
        mode !== "conversations"
      )
        return;
      const target = $("topic-conversation-list");
      $("topic-window-status").textContent = "";
      $("topic-conversation-results").textContent = query ? "Найдено бесед: " + data.total : "";
      if (!append) target.replaceChildren();
      for (const conversation of data.conversations)
        target.append(conversationRow(conversation));
      conversationOffset += data.conversations.length;
      more.hidden = conversationOffset >= data.total;
      more.disabled = false;
      if (!conversationOffset)
        target.append(
          empty(
            query ? "В этой папке совпадений нет" : "Связанных бесед пока нет",
            query ? "Попробуйте другое слово или сбросьте поиск." : "Беседы связываются с темой по исходным сообщениям сохранённых знаний.",
          ),
        );
    } catch (error) {
      if (ticket === conversationRequest) {
        more.disabled = false;
        if (append) $("topic-window-status").textContent = error.message;
        else $("topic-conversation-list").replaceChildren(
          empty("Не удалось открыть беседы", error.message),
        );
      }
    }
  }
  function renderReader(data, anchorId) {
    reading = data;
    $("topic-conversation-tools").hidden = true;
    $("topic-conversation-list").hidden = true;
    $("topic-conversation-more").hidden = true;
    $("topic-conversation-reader").hidden = false;
    $("topic-conversation-title").textContent = data.title;
    $("topic-conversation-meta").textContent = quantity(data.total, ["сообщение", "сообщения", "сообщений"]);
    $("topic-conversation-position").textContent =
      data.offset +
      1 +
      "–" +
      (data.offset + data.messages.length) +
      " из " +
      data.total;
    $("topic-conversation-previous").disabled = data.offset === 0;
    $("topic-conversation-next").disabled =
      data.offset + data.messages.length >= data.total;
    const target = $("topic-conversation-messages");
    target.replaceChildren();
    let anchored;
    for (const message of data.messages) {
      const block = document.createElement("article");
      block.className = "conversation-message " + message.role;
      block.dataset.messageId = message.id;
      block.append(
        text(
          "small",
          (message.role === "user" ? "Вы" : "Amayori") +
            (date(message.at) ? " · " + date(message.at) : ""),
          "conversation-message-meta",
        ),
      );
      const content = document.createElement("div");
      content.className = "conversation-message-content";
      if (UI.renderMessageContent)
        UI.renderMessageContent(content, message.content);
      else content.textContent = message.content;
      block.append(content);
      let armed = false;
      const forget = action("", async () => {
        if (!armed) {
          armed = true;
          forget.textContent = "Удалить?";
          forget.classList.add("armed");
          setTimeout(() => { armed = false; forget.classList.remove("armed"); forget.innerHTML = icon("close"); }, 4000);
          return;
        }
        forget.disabled = true;
        const ticket = conversationRequest;
        try {
          const result = await api("/api/chats?id=" + encodeURIComponent(message.id), {method:"DELETE"});
          document.dispatchEvent(new Event("amayori-chat-updated"));
          document.dispatchEvent(new Event("amayori-chat-removed"));
          await load();
          if (dialog.open && ticket === conversationRequest) {
            if (data.total > 1) {
              const next = data.messages.find(item => String(item.id) !== String(message.id));
              await openConversation(next ? "" : data.id, {offset:Math.max(0,data.offset - (next ? 0 : 1)),messageId:next?.id});
            } else await loadConversations();
          }
          notify(result.facts ? "Сообщение удалено, забыто знаний: " + result.facts : "Сообщение удалено");
        } catch (error) { notify(error.message, "error"); forget.disabled = false; }
      }, "icon-button archive-forget");
      forget.innerHTML = icon("close");
      forget.title = "Удалить сообщение";
      forget.setAttribute("aria-label", "Удалить сообщение");
      block.append(forget);
      target.append(block);
      if (String(message.id) === String(anchorId)) {
        block.classList.add("is-source");
        anchored = block;
      }
    }
    requestAnimationFrame(() => {
      if (anchored) anchored.scrollIntoView({ block: "nearest" });
      else target.scrollTop = 0;
    });
  }
  async function openConversation(
    id,
    { topic = selectedTopic, offset = 0, messageId } = {},
  ) {
    clearTimeout(conversationSearchTimer);
    if (selectedTopic !== topic) $("topic-conversation-search").value = "";
    selectedTopic = topic;
    const select = $("knowledge-topic-filter");
    if (topic && ![...select.options].some((o) => o.value === topic))
      select.add(new Option(topic, topic));
    select.value = topic;
    headings();
    chooseMode("conversations");
    if (!dialog.open) dialog.showModal();
    const ticket = ++conversationRequest;
    $("topic-conversation-reader").hidden = true;
    $("topic-conversation-tools").hidden = true;
    $("topic-conversation-more").hidden = true;
    $("topic-conversation-list").replaceChildren();
    $("topic-conversation-list").hidden = false;
    $("topic-window-status").textContent = "Открываем беседу…";
    try {
      const params = new URLSearchParams({
        id,
        offset: String(offset),
        limit: "50",
      });
      if (messageId) params.set("messageId", messageId);
      const data = await api("/api/conversations/item?" + params);
      if (ticket !== conversationRequest || !dialog.open) return;
      $("topic-window-status").textContent = "";
      renderReader(data, messageId);
    } catch (error) {
      if (ticket === conversationRequest)
        $("topic-window-status").textContent = error.message;
    }
  }
  async function openSource(messageId, factId) {
    clearTimeout(conversationSearchTimer);
    const ticket = ++conversationRequest;
    try {
      const data = await api(
        "/api/conversations/source?" +
          new URLSearchParams({ factId, messageId }),
      );
      if (ticket !== conversationRequest || !dialog.open) return;
      chooseMode("conversations");
      renderReader(data, data.anchorId || String(messageId));
    } catch (error) {
      $("topic-window-status").textContent = error.message;
    }
  }
  async function loadArchive(append = false) {
    const ticket = ++archiveRequest;
    const more = $("archive-more");
    more.disabled = true;
    if (!append) { archiveOffset = 0; more.hidden = true; }
    try {
      const data = await api(
        "/api/conversations/grouped?" +
          new URLSearchParams({
            q: $("archive-search").value.trim(),
            offset: String(archiveOffset),
            limit: "30",
          }),
      );
      if (ticket !== archiveRequest) return;
      const target = $("archive-list");
      if (!append) target.replaceChildren();
      for (const conversation of data.conversations)
        target.append(conversationRow(conversation, { archive: true }));
      archiveOffset += data.conversations.length;
      more.hidden = archiveOffset >= data.total;
      more.disabled = false;
      $("archive-summary").textContent = "Бесед: " + data.total;
      if (!archiveOffset)
        target.append(
          empty(
            $("archive-search").value
              ? "Совпадений нет"
              : "Здесь появятся беседы",
            "Переписка сохраняется полностью. Каждая беседа отображается одной строкой.",
          ),
        );
    } catch (error) {
      if (ticket === archiveRequest) {
        more.disabled = false;
        if (append) $("archive-summary").textContent = error.message;
        else $("archive-list").replaceChildren(
          empty("Не удалось открыть беседы", error.message),
        );
      }
    }
  }
  $("topic-window-close").addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
  });
  dialog.addEventListener("close", () => {
    clearTimeout(conversationSearchTimer);
    ++conversationRequest;
    UI.knowledge.closeDetail();
    $("topic-window-status").textContent = "";
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      close();
  });
  $("topic-parent").addEventListener("click", () =>
    selectedTopic.includes(" / ")
      ? void open(selectedTopic.split(" / ")[0])
      : close(),
  );
  $("topic-tab-knowledge").addEventListener("click", () => {
    ++conversationRequest;
    chooseMode("knowledge");
    void UI.knowledge.load();
  });
  $("topic-tab-conversations").addEventListener("click", () => {
    chooseMode("conversations");
    void loadConversations();
  });
  $("topic-tab-attention").addEventListener("click", () => {
    ++conversationRequest;
    chooseMode("attention");
    renderAttention();
  });
  $("knowledge-topic-filter").addEventListener(
    "change",
    (event) => void open(event.target.value),
  );
  $("topic-conversation-back").addEventListener(
    "click",
    () => void loadConversations(),
  );
  $("topic-conversation-more").addEventListener(
    "click",
    () => void loadConversations(true),
  );
  $("topic-conversation-previous").addEventListener("click", () => {
    if (reading)
      void openConversation(reading.id, {
        offset: Math.max(0, reading.offset - reading.limit),
      });
  });
  $("topic-conversation-next").addEventListener("click", () => {
    if (reading)
      void openConversation(reading.id, {
        offset: reading.offset + reading.limit,
      });
  });
  $("archive-more").addEventListener("click", () => void loadArchive(true));
  $("archive-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    ++archiveRequest;
    $("archive-more").hidden = true;
    $("archive-more").disabled = true;
    searchTimer = setTimeout(() => void loadArchive(), 150);
  });
  $("topic-conversation-search").addEventListener("input", () => {
    clearTimeout(conversationSearchTimer);
    ++conversationRequest;
    $("topic-conversation-more").hidden = true;
    $("topic-conversation-more").disabled = true;
    conversationSearchTimer = setTimeout(() => void loadConversations(), 180);
  });
  $("topic-folder-search").addEventListener("input", () => renderFolders({resetScroll:true}));
  $("topic-folder-filter").addEventListener("change", () => renderFolders({resetScroll:true}));
  addEventListener("storage", (event) => {
    if (event.key !== preferencesKey && event.key !== null) return;
    try { preferences = navigation.normalize(JSON.parse(localStorage.getItem(preferencesKey))); }
    catch { preferences = navigation.normalize(null); }
    renderFolders();
  });
  UI.topics = {
    load,
    open,
    close,
    loadArchive,
    openConversation,
    openSource,
    get isOpen() {
      return dialog.open;
    },
    get activePanel() {
      return mode;
    },
    get activeTopic() {
      return selectedTopic;
    },
    async refreshAndOpenFact(id) {
      const fact = await api(
        "/api/knowledge/card?id=" + encodeURIComponent(id),
      );
      await load();
      await open(fact.topic || "Без темы");
      $("knowledge-status-filter").value = ["candidate", "superseded"].includes(
        fact.status,
      )
        ? fact.status
        : "active";
      await UI.knowledge.load();
      await UI.knowledge.showDetail(id);
    },
  };
  document.addEventListener("amayori-knowledge-updated", () => void load());
  setInterval(() => {
    if (
      document.hidden ||
      UI.state?.page !== "memory" ||
      UI.state.tab !== "facts"
    )
      return;
    void load();
  }, 8000);
})();
