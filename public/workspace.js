(() => {
  "use strict";
  const UI = window.AmayoriUI,
    P = globalThis.AmayoriWorkspacePrefs;
  const $ = (id) => document.getElementById(id),
    storageKey = "amayori-workspace";
  let prefs = P.defaults(),
    layout = { split: false, visiblePages: ["chat"], content: "graph" },
    resizing = null;
  try {
    prefs = P.normalize(JSON.parse(localStorage.getItem(storageKey)));
  } catch {}
  const definitions = {
    chat: {
      name: "Диалог",
      icon: "chat",
      node: document.querySelector('.rail-nav [data-page="chat"]'),
    },
    memory: {
      name: "Память",
      icon: "archive",
      node: document.querySelector('.rail-nav [data-page="memory"]'),
    },
    graph: {
      name: "Карта знаний",
      icon: "graph",
      node: document.querySelector('.rail-nav [data-page="graph"]'),
    },
    golem: {
      name: "Голем",
      icon: "brain",
      node: document.querySelector('.rail-nav a[href="/golem"]'),
    },
  };
  const pinned = $("nav-pinned"),
    overflow = $("nav-overflow-links"),
    more = $("nav-more"),
    popup = $("nav-overflow"),
    workspace = $("workspace"),
    divider = $("workspace-separator");
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(prefs));
    } catch {
      UI.notify(
        "Браузер не разрешил сохранить настройки рабочего места",
        "error",
      );
    }
  }
  function closeMore(focus = false) {
    popup.hidden = true;
    more.setAttribute("aria-expanded", "false");
    if (focus && !more.hidden) more.focus();
  }
  function positionMore() {
    if (popup.hidden) return;
    const rect = more.getBoundingClientRect();
    popup.style.left =
      Math.min(rect.right + 10, innerWidth - popup.offsetWidth - 8) + "px";
    popup.style.top =
      Math.max(8, Math.min(rect.top, innerHeight - popup.offsetHeight - 8)) +
      "px";
  }
  function markActive(page) {
    const current =
      Object.hasOwn(definitions, page) &&
      !prefs.navigation.pinned.includes(page);
    more.dataset.current = String(current);
    more.setAttribute(
      "aria-label",
      current ? "Ещё: открыт раздел «" + definitions[page].name + "»" : "Ещё",
    );
  }
  function renderNavigation() {
    const hidden = [];
    for (const id of prefs.navigation.order) {
      const node = definitions[id].node;
      node.dataset.navId = id;
      if (prefs.navigation.pinned.includes(id)) pinned.append(node);
      else {
        overflow.append(node);
        hidden.push(id);
      }
    }
    more.hidden = !hidden.length;
    if (more.hidden) closeMore();
    markActive(UI.state?.page || "chat");
    positionMore();
  }
  function actionButton(icon, label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.innerHTML = UI.icon(icon);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", action);
    return button;
  }
  function changeNavigation(id, nextIndex, direction) {
    prefs.navigation.order = P.move(prefs.navigation.order, id, nextIndex);
    save();
    renderNavigation();
    renderEditor();
    const row = $("menu-editor").querySelector('[data-menu-id="' + id + '"]');
    const control = direction
      ? row.querySelector('[data-direction="' + direction + '"]')
      : null;
    (control && !control.disabled ? control : row).focus({
      preventScroll: true,
    });
  }
  function renderEditor() {
    const list = $("menu-editor");
    list.replaceChildren();
    prefs.navigation.order.forEach((id, index) => {
      const item = document.createElement("li");
      item.className = "menu-editor-row";
      item.dataset.menuId = id;
      item.tabIndex = -1;
      const handle = document.createElement("span");
      handle.className = "menu-grip";
      handle.draggable = true;
      handle.title = "Перетащите для изменения порядка";
      handle.setAttribute("aria-hidden", "true");
      handle.innerHTML = UI.icon("grip");
      handle.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
      });
      item.addEventListener("dragover", (event) => {
        if (event.dataTransfer.types.includes("text/plain")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      });
      item.addEventListener("drop", (event) => {
        const moved = event.dataTransfer.getData("text/plain");
        if (P.sections.includes(moved)) {
          event.preventDefault();
          changeNavigation(moved, index);
        }
      });
      const name = document.createElement("span");
      name.className = "menu-section-name";
      name.innerHTML = UI.icon(definitions[id].icon);
      name.append(document.createTextNode(definitions[id].name));
      const actions = document.createElement("div");
      actions.className = "menu-row-actions";
      const up = actionButton("arrow", "Выше: " + definitions[id].name, () =>
        changeNavigation(id, index - 1, "up"),
      );
      up.disabled = index === 0;
      up.dataset.direction = "up";
      const down = actionButton("arrow", "Ниже: " + definitions[id].name, () =>
        changeNavigation(id, index + 1, "down"),
      );
      down.disabled = index === prefs.navigation.order.length - 1;
      down.classList.add("move-down");
      down.dataset.direction = "down";
      const active = prefs.navigation.pinned.includes(id);
      const pin = actionButton(
        "pin",
        (active ? "В «Ещё»: " : "Закрепить: ") + definitions[id].name,
        () => {
          prefs.navigation.pinned = active
            ? prefs.navigation.pinned.filter((value) => value !== id)
            : prefs.navigation.order.filter(
                (value) =>
                  value === id || prefs.navigation.pinned.includes(value),
              );
          save();
          renderNavigation();
          renderEditor();
          $("menu-editor")
            .querySelector('[data-menu-id="' + id + '"] .menu-pin')
            ?.focus({ preventScroll: true });
        },
      );
      pin.classList.add("menu-pin");
      pin.setAttribute("aria-pressed", String(active));
      actions.append(up, down, pin);
      item.append(handle, name, actions);
      list.append(item);
    });
  }
  function fields() {
    $("workspace-enabled").checked = prefs.split.enabled;
    $("workspace-target").value = prefs.split.target;
    $("workspace-chat-side").value = prefs.split.chatSide;
    $("workspace-share").value = prefs.split.share;
    $("workspace-share-value").value = prefs.split.share + "%";
    $("workspace-context").value = layout.content;
  }
  function geometry() {
    const style = getComputedStyle(workspace);
    const width =
      workspace.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    const axis = width < 840 ? "y" : "x";
    workspace.dataset.splitAxis = axis;
    workspace.dataset.chatSide = prefs.split.chatSide;
    workspace.style.setProperty("--chat-track", prefs.split.share + "fr");
    workspace.style.setProperty(
      "--context-track",
      100 - prefs.split.share + "fr",
    );
    divider.setAttribute(
      "aria-orientation",
      axis === "x" ? "vertical" : "horizontal",
    );
    divider.setAttribute("aria-valuenow", String(prefs.split.share));
    divider.setAttribute(
      "aria-valuetext",
      "Диалог занимает " + prefs.split.share + "%",
    );
    document.dispatchEvent(new Event("amayori-layout"));
  }
  function apply(page, tab, rememberContext = false) {
    layout = P.layout(prefs, page, tab);
    if (
      rememberContext &&
      layout.split &&
      prefs.split.target !== layout.content
    ) {
      prefs.split.target = layout.content;
      save();
    }
    workspace.classList.toggle("workspace-split", layout.split);
    divider.hidden = !layout.split;
    $("workspace-toggle").hidden =
      !["chat", "graph"].includes(page) &&
      !(page === "memory" && tab === "archive");
    $("workspace-toggle").setAttribute("aria-pressed", String(layout.split));
    $("workspace-toggle").title = layout.split
      ? "Один экран"
      : "Чат рядом с картой или архивом";
    fields();
    geometry();
    markActive(page);
    return layout;
  }
  function updateSplit(patch, refresh = true) {
    prefs = P.normalize({ ...prefs, split: { ...prefs.split, ...patch } });
    save();
    fields();
    if (refresh && UI.refreshWorkspace) UI.refreshWorkspace();
    else geometry();
  }
  function setTarget(target) {
    const previous = layout;
    updateSplit({ target }, false);
    if (previous.split && UI.state.page !== "chat")
      UI.navigate(
        target === "archive" ? "memory" : "graph",
        target === "archive" ? "archive" : undefined,
      );
    else UI.refreshWorkspace?.();
  }
  UI.workspace = {
    apply,
    markActive,
    updateSplit,
    get preferences() {
      return prefs;
    },
    get layout() {
      return layout;
    },
  };
  $("workspace-toggle").addEventListener("click", () =>
    updateSplit({ enabled: !prefs.split.enabled }),
  );
  $("workspace-enabled").addEventListener("change", (event) =>
    updateSplit({ enabled: event.target.checked }),
  );
  $("workspace-target").addEventListener("change", (event) =>
    setTarget(event.target.value),
  );
  $("workspace-context").addEventListener("change", (event) =>
    setTarget(event.target.value),
  );
  $("workspace-chat-side").addEventListener("change", (event) =>
    updateSplit({ chatSide: event.target.value }, false),
  );
  $("workspace-share").addEventListener("input", (event) =>
    updateSplit({ share: Number(event.target.value) }, false),
  );
  $("reset-menu").addEventListener("click", () => {
    prefs.navigation = P.defaults().navigation;
    save();
    renderNavigation();
    renderEditor();
    UI.notify("Порядок меню восстановлен");
  });
  more.addEventListener("click", () => {
    popup.hidden = !popup.hidden;
    more.setAttribute("aria-expanded", String(!popup.hidden));
    if (!popup.hidden) {
      positionMore();
      popup.querySelector("a")?.focus();
    }
  });
  popup.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMore();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!popup.contains(event.target) && !more.contains(event.target))
      closeMore();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popup.hidden) {
      event.preventDefault();
      closeMore(true);
    }
  });
  popup.addEventListener("keydown", (event) => {
    const links = [...popup.querySelectorAll("a")],
      index = links.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? links.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) %
              links.length;
      links[next]?.focus();
    }
  });
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const bounds = workspace.getBoundingClientRect(),
      rect = divider.getBoundingClientRect(),
      css = getComputedStyle(workspace),
      axis = workspace.dataset.splitAxis;
    resizing = {
      axis,
      start:
        axis === "x"
          ? bounds.left + parseFloat(css.paddingLeft)
          : bounds.top + parseFloat(css.paddingTop),
      length:
        axis === "x"
          ? workspace.clientWidth -
            parseFloat(css.paddingLeft) -
            parseFloat(css.paddingRight) -
            12
          : workspace.clientHeight -
            parseFloat(css.paddingTop) -
            parseFloat(css.paddingBottom) -
            12,
      offset:
        axis === "x"
          ? event.clientX - rect.left - 6
          : event.clientY - rect.top - 6,
      initial: prefs.split.share,
    };
    divider.setPointerCapture(event.pointerId);
    workspace.dataset.resizing = "true";
    event.preventDefault();
  });
  divider.addEventListener("pointermove", (event) => {
    if (!resizing) return;
    const position =
      (((resizing.axis === "x" ? event.clientX : event.clientY) -
        resizing.offset -
        resizing.start -
        6) /
        resizing.length) *
      100;
    prefs.split.share = P.normalize({
      split: {
        share: prefs.split.chatSide === "left" ? position : 100 - position,
      },
    }).split.share;
    fields();
    geometry();
  });
  divider.addEventListener("pointerup", () => {
    if (resizing) {
      resizing = null;
      delete workspace.dataset.resizing;
      save();
    }
  });
  divider.addEventListener("pointercancel", () => {
    if (resizing) {
      prefs.split.share = resizing.initial;
      resizing = null;
      delete workspace.dataset.resizing;
      fields();
      geometry();
    }
  });
  divider.addEventListener("dblclick", () => updateSplit({ share: 50 }, false));
  divider.addEventListener("keydown", (event) => {
    const keys =
      workspace.dataset.splitAxis === "x"
        ? ["ArrowLeft", "ArrowRight"]
        : ["ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key) && !["Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    const delta =
      (event.key === keys[1] ? 1 : -1) *
      (prefs.split.chatSide === "left" ? 1 : -1) *
      (event.shiftKey ? 5 : 1);
    updateSplit(
      {
        share:
          event.key === "Home"
            ? 35
            : event.key === "End"
              ? 65
              : prefs.split.share + delta,
      },
      false,
    );
  });
  new ResizeObserver(() => {
    if (layout.split) geometry();
  }).observe(workspace);
  addEventListener("resize", positionMore);
  document.addEventListener("amayori-layout", positionMore);
  addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    try {
      prefs = P.normalize(JSON.parse(event.newValue));
    } catch {
      prefs = P.defaults();
    }
    renderNavigation();
    renderEditor();
    fields();
    UI.refreshWorkspace?.();
  });
  renderNavigation();
  renderEditor();
  fields();
})();
