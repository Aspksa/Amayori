(() => {
  "use strict";
  const icon = (name) =>
    `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Не удалось выполнить запрос");
    return data;
  }
  function notify(message, tone = "info") {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.dataset.tone = tone;
    el.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => {
      el.hidden = true;
    }, 5500);
  }
  function empty(title, description) {
    const box = document.createElement("div");
    box.className = "empty-state compact";
    const h = document.createElement("h3"),
      p = document.createElement("p");
    h.textContent = title;
    p.textContent = description;
    box.append(h, p);
    return box;
  }
  function mark(text, query) {
    const fragment = document.createDocumentFragment(),
      value = String(text),
      q = String(query).trim();
    if (!q) {
      fragment.append(document.createTextNode(value));
      return fragment;
    }
    const lower = value.toLocaleLowerCase("ru"),
      needle = q.toLocaleLowerCase("ru");
    let cursor = 0,
      index;
    while ((index = lower.indexOf(needle, cursor)) !== -1) {
      fragment.append(document.createTextNode(value.slice(cursor, index)));
      const m = document.createElement("mark");
      m.textContent = value.slice(index, index + q.length);
      fragment.append(m);
      cursor = index + q.length;
    }
    fragment.append(document.createTextNode(value.slice(cursor)));
    return fragment;
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Скопировано");
    } catch {
      notify("Браузер не разрешил копирование", "error");
    }
  }
  function date(value) {
    const d = new Date(value);
    return Number.isNaN(d.valueOf())
      ? ""
      : d.toLocaleString("ru-RU", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
  }
  window.AmayoriUI = { icon, api, notify, empty, mark, copy, date };
})();
