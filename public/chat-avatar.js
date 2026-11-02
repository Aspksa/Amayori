(() => {
  "use strict";
  const UI = window.AmayoriUI,
    { api, icon, notify, mark, copy } = UI;
  const mount = document.getElementById("chat-workspace");
  const panel = document.createElement("section");
  panel.id = "floating-chat";
  panel.setAttribute("aria-label", "Диалог с Amayori");
  panel.innerHTML = `<header class="chat-top"><label class="model-control">${icon("spark")}<span class="sr-only">Модель для сообщения</span><select id="chat-model"><option value="">Выберите модель</option></select></label><div class="chat-top-actions"><button type="button" class="icon-button" id="chat-find" aria-label="Поиск в диалоге" title="Поиск">${icon("search")}</button><button type="button" class="icon-button" id="chat-more" aria-label="Действия с диалогом" title="Действия" aria-haspopup="menu" aria-expanded="false">${icon("more")}</button><div class="chat-menu" id="chat-menu" role="menu" hidden><button type="button" role="menuitem" id="chat-export">${icon("download")}Экспорт последних 100</button><button type="button" role="menuitem" id="chat-clear-view">${icon("refresh")}Очистить экран</button></div><button type="button" class="icon-button" id="chat-expand" aria-label="Развернуть диалог" title="Развернуть">${icon("expand")}</button><button type="button" class="icon-button" id="chat-close" aria-label="Закрыть диалог" title="Закрыть">${icon("close")}</button></div></header><div class="chat-search-bar" id="chat-search-bar" hidden><label class="search-field">${icon("search")}<input id="chat-search" type="search" placeholder="Найти в диалоге" aria-label="Поиск в загруженной истории"></label><span id="chat-search-count" class="chat-search-count"></span><button class="icon-button" type="button" id="chat-search-close" aria-label="Закрыть поиск">${icon("close")}</button></div><div id="chat-history" class="scroll-area" role="log" aria-label="Переписка" aria-live="polite" aria-relevant="additions text"></div><div class="chat-composer"><div id="chat-connection-hint" class="connection-hint" hidden>${icon("link")}<span>Для диалога нужна модель.</span><button type="button" id="chat-connect">Подключить</button></div><form id="chat-form"><div class="composer-box"><label for="chat-input" class="sr-only">Ваше сообщение</label><textarea id="chat-input" rows="1" maxlength="4000" placeholder="Напишите, о чём думаете…" autocomplete="off" required></textarea><div class="composer-actions"><span class="composer-shortcut"><kbd>Enter</kbd> — отправить · <kbd>Shift + Enter</kbd> — новая строка</span><span id="chat-input-count" class="composer-count" hidden></span><button id="chat-send" type="submit" aria-label="Отправить сообщение" title="Отправить" disabled>${icon("arrow")}</button></div></div></form><p class="chat-footer" id="chat-footer"></p></div>`;
  mount.append(panel);
  const $ = (id) => panel.querySelector("#" + id),
    history = $("chat-history"),
    input = $("chat-input"),
    select = $("chat-model");
  const avatar = document.createElement("button");
  avatar.id = "chat-avatar";
  avatar.type = "button";
  avatar.innerHTML = icon("fox");
  avatar.setAttribute("aria-label", "Открыть диалог");
  avatar.setAttribute("aria-controls", "floating-chat");
  avatar.setAttribute("aria-expanded", "false");
  avatar.title = "Открыть диалог · можно перетащить";
  document.body.append(avatar);
  let records = [],
    config = UI.state.settings,
    models = UI.models || [],
    busy = false,
    historyLoaded = false,
    revision = 0,
    searchQuery = "";
  function allowed() {
    return config.hasKey && !!(select.value || config.model);
  }
  function composeState() {
    $("chat-send").disabled = busy || !input.value.trim() || !allowed();
    $("chat-connection-hint").hidden = allowed();
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 174) + "px";
    $("chat-input-count").hidden = input.value.length < 3500;
    $("chat-input-count").textContent = input.value.length + " / 4000";
  }
  function updateModels() {
    const selected = select.value;
    select.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent =
      models.find((model) => model.id === config.model)?.name ||
      config.model ||
      "Выберите модель";
    select.append(defaultOption);
    for (const model of models) {
      if (model.id === config.model) continue;
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name || model.id;
      select.append(option);
    }
    if (
      selected &&
      ![...select.options].some((option) => option.value === selected) &&
      selected !== config.model
    ) {
      const option = document.createElement("option");
      option.value = selected;
      option.textContent = selected;
      select.append(option);
    }
    select.value = selected === config.model ? "" : selected;
    select.title = select.selectedOptions[0]?.textContent || "";
    composeState();
  }
  document.addEventListener("amayori-config", (event) => {
    config = event.detail;
    updateModels();
  });
  document.addEventListener("amayori-models", (event) => {
    models = event.detail;
    updateModels();
  });
  select.addEventListener("change", () => {
    select.title = select.selectedOptions[0]?.textContent || "";
    composeState();
  });
  $("chat-connect").addEventListener("click", () => {
    UI.navigate("settings", "connection");
    requestAnimationFrame(() =>
      document.getElementById(config.hasKey ? "model" : "api-key").focus(),
    );
  });
  function welcome() {
    const box = document.createElement("div");
    box.className = "chat-empty";
    box.innerHTML = `<span class="chat-emblem">${icon("fox")}</span><h2>Место для ваших мыслей</h2><p>Разберём сложное, найдём связи<br>и сохраним важное.</p><div class="suggestion-row"><button class="suggestion" type="button">Помоги разобраться в идее</button><button class="suggestion" type="button">Давай составим план</button></div>`;
    box.querySelectorAll("button").forEach((button) =>
      button.addEventListener("click", () => {
        input.value = button.textContent;
        composeState();
        input.focus();
      }),
    );
    return box;
  }
  function renderContent(target, text, query = "") {
    target.replaceChildren();
    const chunks = String(text).split(/```([^\n`]*)\n([\s\S]*?)```/g);
    for (let i = 0; i < chunks.length; i++) {
      if (i % 3 === 1) {
        const language = chunks[i].trim().slice(0, 30),
          code = chunks[i + 1] || "",
          block = document.createElement("div");
        block.className = "code-block";
        const header = document.createElement("div");
        header.className = "code-header";
        const label = document.createElement("span");
        label.textContent = language || "Код";
        const button = document.createElement("button");
        button.type = "button";
        button.innerHTML = icon("copy");
        button.append(document.createTextNode("Копировать"));
        button.setAttribute("aria-label", "Скопировать код");
        button.addEventListener("click", () => void copy(code));
        header.append(label, button);
        const pre = document.createElement("pre"),
          element = document.createElement("code");
        element.append(mark(code, query));
        pre.append(element);
        block.append(header, pre);
        target.append(block);
        i++;
        continue;
      }
      if (!chunks[i].trim()) continue;
      const p = document.createElement("p");
      for (const fragment of chunks[i]
        .trim()
        .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)) {
        if (fragment.startsWith("**") && fragment.endsWith("**")) {
          const strong = document.createElement("strong");
          strong.append(mark(fragment.slice(2, -2), query));
          p.append(strong);
        } else if (fragment.startsWith("`") && fragment.endsWith("`")) {
          const code = document.createElement("code");
          code.className = "inline-code";
          code.append(mark(fragment.slice(1, -1), query));
          p.append(code);
        } else p.append(mark(fragment, query));
      }
      target.append(p);
    }
  }
  function messageNode(record) {
    const article = document.createElement("article");
    article.className = "message " + record.role;
    article._record = record;
    article.setAttribute(
      "aria-label",
      record.role === "user" ? "Ваше сообщение" : "Ответ",
    );
    if (record.role === "assistant") {
      const emblem = document.createElement("span");
      emblem.className = "message-emblem";
      emblem.setAttribute("aria-hidden", "true");
      emblem.innerHTML = icon("fox");
      article.append(emblem);
    }
    const main = document.createElement("div");
    main.className = "message-main";
    const body = document.createElement("div");
    body.className = "message-body";
    renderContent(body, record.content, searchQuery);
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("time");
    const parsed = new Date(record.at);
    if (!Number.isNaN(parsed.valueOf())) {
      time.dateTime = parsed.toISOString();
      time.textContent = parsed.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    meta.append(time);
    if (record.role === "assistant") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "icon-button";
      button.innerHTML = icon("copy");
      button.setAttribute("aria-label", "Скопировать ответ");
      button.title = "Скопировать ответ";
      button.addEventListener("click", () => void copy(record.content));
      meta.append(button);
    }
    main.append(body, meta);
    article.append(main);
    return article;
  }
  function dayLabel(value) {
    const d = new Date(value);
    if (Number.isNaN(d.valueOf())) return "";
    const now = new Date(),
      yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    return d.toDateString() === now.toDateString()
      ? "Сегодня"
      : d.toDateString() === yesterday.toDateString()
        ? "Вчера"
        : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }
  function renderHistory() {
    history.replaceChildren();
    if (!records.length) {
      history.append(welcome());
      return;
    }
    let day = "";
    for (const record of records) {
      const next = dayLabel(record.at);
      if (next && next !== day) {
        const divider = document.createElement("div");
        divider.className = "chat-day";
        divider.textContent = next;
        history.append(divider);
        day = next;
      }
      history.append(messageNode(record));
    }
    filterHistory();
    scrollEnd();
  }
  function scrollEnd() {
    history.scrollTop = history.scrollHeight;
  }
  function filterHistory() {
    searchQuery = $("chat-search").value.trim();
    const lower = searchQuery.toLocaleLowerCase("ru");
    let found = 0;
    for (const item of history.querySelectorAll(".message")) {
      const visible =
        !lower || item._record.content.toLocaleLowerCase("ru").includes(lower);
      item.hidden = !visible;
      if (visible) found++;
      if (!item.classList.contains("pending"))
        renderContent(
          item.querySelector(".message-body"),
          item._record.content,
          searchQuery,
        );
    }
    history
      .querySelectorAll(".chat-day")
      .forEach((day) => (day.hidden = !!lower));
    $("chat-search-count").textContent = searchQuery
      ? found + " совпадений"
      : "";
  }
  async function loadHistory() {
    const version = revision;
    try {
      const data = await api("/api/chats");
      if (version !== revision || busy) return;
      records = (data.messages || []).filter(
        (message) =>
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string",
      );
      renderHistory();
    } catch (error) {
      if (!records.length) renderHistory();
      $("chat-footer").textContent = "Архив сейчас недоступен";
      console.warn("Chat archive:", error.message);
    } finally {
      historyLoaded = true;
    }
  }
  function placeChat(page, visiblePages = UI.state.visiblePages || [page]) {
    const docked = visiblePages.includes("chat"),
      changed = panel.parentElement !== (docked ? mount : document.body);
    panel.classList.toggle("floating", !docked);
    panel.setAttribute("role", docked ? "region" : "dialog");
    panel.removeAttribute("aria-modal");
    avatar.hidden = docked;
    if (changed) {
      panel.classList.remove("expanded");
      if (docked) {
        mount.append(panel);
        panel.hidden = false;
      } else {
        document.body.append(panel);
        panel.hidden = true;
      }
      avatar.setAttribute("aria-expanded", "false");
      closeMenu();
    } else if (docked) panel.hidden = false;
    if (!docked) {
      panel.classList.remove("expanded");
      panel.hidden = true;
      avatar.setAttribute("aria-expanded", "false");
      closeMenu();
    }
    $("chat-expand").innerHTML = icon(
      panel.classList.contains("expanded") ? "collapse" : "expand",
    );
    $("chat-expand").setAttribute(
      "aria-label",
      docked && UI.state.split ? "Диалог на весь экран" : "Развернуть диалог",
    );
    requestAnimationFrame(() => {
      composeState();
      if (changed && docked) scrollEnd();
    });
  }
  function toggleOverlay() {
    if (UI.isViewVisible("chat")) {
      input.focus();
      return;
    }
    panel.hidden = !panel.hidden;
    avatar.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      requestAnimationFrame(() => {
        composeState();
        scrollEnd();
        input.focus();
      });
    }
  }
  function closeOverlay() {
    panel.hidden = true;
    avatar.setAttribute("aria-expanded", "false");
    avatar.focus();
  }
  document.addEventListener("amayori-view", (event) =>
    placeChat(event.detail.page, event.detail.visiblePages),
  );
  placeChat(UI.state.page);
  $("chat-close").addEventListener("click", closeOverlay);
  $("chat-expand").addEventListener("click", () => {
    if (!panel.classList.contains("floating") && UI.state.split) {
      UI.workspace.updateSplit({ enabled: false });
      UI.navigate("chat");
      return;
    }
    const expanded = panel.classList.toggle("expanded");
    $("chat-expand").innerHTML = icon(expanded ? "collapse" : "expand");
    $("chat-expand").setAttribute(
      "aria-label",
      expanded ? "Свернуть диалог" : "Развернуть диалог",
    );
    requestAnimationFrame(composeState);
  });
  function closeMenu() {
    $("chat-menu").hidden = true;
    $("chat-more").setAttribute("aria-expanded", "false");
  }
  $("chat-more").addEventListener("click", () => {
    const open = $("chat-menu").hidden;
    $("chat-menu").hidden = !open;
    $("chat-more").setAttribute("aria-expanded", String(open));
    if (open) $("chat-menu").querySelector("button").focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      !$("chat-menu").contains(event.target) &&
      !$("chat-more").contains(event.target)
    )
      closeMenu();
  });
  $("chat-menu").addEventListener("keydown", (event) => {
    const items = [...$("chat-menu").querySelectorAll("button")],
      index = items.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      items[
        (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length
      ].focus();
    }
  });
  function closeSearch() {
    $("chat-search-bar").hidden = true;
    $("chat-search").value = "";
    $("chat-find").classList.remove("active");
    filterHistory();
    input.focus();
  }
  $("chat-find").addEventListener("click", () => {
    const open = $("chat-search-bar").hidden;
    $("chat-search-bar").hidden = !open;
    $("chat-find").classList.toggle("active", open);
    if (open) $("chat-search").focus();
    else closeSearch();
  });
  $("chat-search").addEventListener("input", filterHistory);
  $("chat-search-close").addEventListener("click", closeSearch);
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.key !== "Escape" || panel.hidden)
      return;
    if (!$("chat-menu").hidden) {
      closeMenu();
      $("chat-more").focus();
    } else if (!$("chat-search-bar").hidden) closeSearch();
    else if (panel.classList.contains("floating")) closeOverlay();
  });
  input.addEventListener("input", composeState);
  input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      (!matchMedia("(pointer: coarse)").matches ||
        event.ctrlKey ||
        event.metaKey)
    ) {
      event.preventDefault();
      $("chat-form").requestSubmit();
    }
  });
  $("chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (busy || !text || !allowed()) return;
    busy = true;
    revision++;
    searchQuery = "";
    $("chat-search").value = "";
    if (!$("chat-search-bar").hidden) filterHistory();
    history.querySelector(".chat-empty")?.remove();
    const at = new Date().toISOString();
    const user = { role: "user", content: text, at };
    if (dayLabel(records.at(-1)?.at) !== dayLabel(at)) {
      const divider = document.createElement("div");
      divider.className = "chat-day";
      divider.textContent = dayLabel(at);
      history.append(divider);
    }
    records.push(user);
    history.append(messageNode(user));
    input.value = "";
    composeState();
    const pending = { role: "assistant", content: "Ожидаем ответ…", at },
      reply = messageNode(pending);
    reply.classList.add("pending");
    reply.querySelector(".message-body").innerHTML =
      '<span class="typing-dots" aria-label="Ожидаем ответ"><i></i><i></i><i></i></span>';
    history.append(reply);
    scrollEnd();
    const started = performance.now();
    try {
      const data = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, model: select.value }),
      });
      const answer = {
        role: "assistant",
        content: data.answer,
        at: new Date().toISOString(),
      };
      records.push(answer);
      const rendered = messageNode(answer);
      rendered.title =
        "Ответ за " +
        Math.max(1, Math.round((performance.now() - started) / 1000)) +
        " с";
      reply.replaceWith(rendered);
      document.dispatchEvent(
        new CustomEvent("amayori-trace", { detail: data }),
      );
      document.dispatchEvent(new Event("amayori-chat-updated"));
      document.dispatchEvent(new Event("amayori-chat-success"));
      try {
        localStorage.setItem("amayori-chat-update", String(Date.now()));
      } catch {}
      $("chat-footer").textContent = "";
    } catch (error) {
      reply.classList.remove("pending");
      reply.classList.add("error");
      reply._record.content = error.message;
      renderContent(reply.querySelector(".message-body"), error.message);
      if (!input.value) input.value = text;
      $("chat-footer").textContent =
        "Ответ не получен. Сообщение можно отправить ещё раз.";
    } finally {
      busy = false;
      composeState();
      scrollEnd();
      input.focus();
    }
  });
  $("chat-clear-view").addEventListener("click", () => {
    if (busy) {
      notify("Дождитесь ответа модели");
      return;
    }
    revision++;
    records = [];
    $("chat-search").value = "";
    searchQuery = "";
    renderHistory();
    closeMenu();
    notify("Экран очищен. Архив сохранён.");
  });
  $("chat-export").addEventListener("click", async () => {
    closeMenu();
    try {
      const data = await api("/api/chats");
      const content = (data.messages || [])
        .map(
          (message) =>
            "[" +
            UI.date(message.at) +
            "] " +
            (message.role === "user" ? "Вы" : "Ответ") +
            ": " +
            message.content,
        )
        .join("\n\n");
      const blob = new Blob(["\uFEFF" + content], {
          type: "text/plain;charset=utf-8",
        }),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download =
        "Amayori-" + new Date().toISOString().slice(0, 10) + ".txt";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify(error.message, "error");
    }
  });
  let pos = { x: innerWidth - 84, y: innerHeight - 84 },
    drag = null,
    suppressClick = false;
  try {
    const saved = JSON.parse(localStorage.getItem("amayori-avatar-position"));
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) pos = saved;
  } catch {}
  function clamp() {
    const size = innerWidth <= 600 ? 51 : 58,
      rail =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--rail-width",
          ),
        ) || 72;
    pos.x = Math.max(rail + 6, Math.min(innerWidth - size - 8, pos.x));
    pos.y = Math.max(8, Math.min(innerHeight - size - 8, pos.y));
    avatar.style.left = pos.x + "px";
    avatar.style.top = pos.y + "px";
  }
  avatar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      px: pos.x,
      py: pos.y,
      moved: false,
    };
    avatar.setPointerCapture(event.pointerId);
  });
  avatar.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) {
      pos = { x: drag.px + dx, y: drag.py + dy };
      clamp();
    }
  });
  avatar.addEventListener("pointerup", () => {
    if (!drag) return;
    suppressClick = drag.moved;
    if (drag.moved)
      try {
        localStorage.setItem("amayori-avatar-position", JSON.stringify(pos));
      } catch {}
    drag = null;
  });
  avatar.addEventListener("pointercancel", () => {
    drag = null;
    suppressClick = false;
  });
  avatar.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    toggleOverlay();
  });
  avatar.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    UI.navigate("settings", "appearance");
  });
  document.addEventListener("amayori-avatar-reset", () => {
    pos = { x: innerWidth - 84, y: innerHeight - 84 };
    clamp();
    try {
      localStorage.removeItem("amayori-avatar-position");
    } catch {}
  });
  addEventListener("resize", () => {
    clamp();
    composeState();
  });
  document.addEventListener("amayori-layout", () => {
    clamp();
    composeState();
  });
  addEventListener("storage", (event) => {
    if (event.key === "amayori-chat-update" && !busy) void loadHistory();
  });
  window.AmayoriChat = {
    openMessage(content) {
      UI.navigate("chat");
      requestAnimationFrame(() => {
        const item = [...history.querySelectorAll(".message")].find(
          (node) => node._record.content === content,
        );
        if (item) {
          $("chat-search").value = "";
          filterHistory();
          item.hidden = false;
          item.scrollIntoView({ block: "center" });
          item.classList.add("flash");
          setTimeout(() => item.classList.remove("flash"), 2400);
        } else if (historyLoaded)
          notify("Это сообщение за пределами загруженной истории");
      });
    },
  };
  clamp();
  updateModels();
  renderHistory();
  void loadHistory();
})();
