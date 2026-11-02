(() => {
  "use strict";
  const UI = window.AmayoriUI,
    { api, notify } = UI;
  const caption = (value) => {
    const text = String(value);
    return text.length > 22 ? text.slice(0, 21).trimEnd() + "…" : text;
  };
  const $ = (id) => document.getElementById(id),
    canvas = $("knowledge-map"),
    ctx = canvas.getContext("2d");
  let graph = { nodes: [], edges: [] },
    points = [],
    offset = 0,
    total = 0,
    filter = "",
    zoom = 1,
    pan = { x: 0, y: 0 },
    drag = null,
    selected = null,
    request = 0,
    loading = false,
    semanticVisible = false,
    source = "";
  function updateInspectorVisibility() {
    const active = selected !== null || semanticVisible;
    const inspector = document.querySelector(".graph-inspector");
    document.querySelector(".graph-workspace").dataset.hasNodes = String(
      graph.nodes.length > 0,
    );
    inspector.dataset.active = String(active);
    $("graph-inspector-close").hidden = !active;
    document
      .querySelector(".graph-workspace")
      .classList.toggle("has-details", active);
    const visible = graph.nodes.length > 0 || semanticVisible;
    document.querySelector(".graph-inspector").hidden = !visible;
    document
      .querySelector(".graph-workspace")
      .classList.toggle("is-empty", !visible);
  }
  function layout() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    const radius = Math.max(30, Math.min(w, h) / 2 - 40);
    points = graph.nodes.map((node, i) => {
      const a = i * 2.39996323,
        r = Math.sqrt((i + 0.6) / Math.max(graph.nodes.length, 1)) * radius;
      return { ...node, x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
    draw();
  }
  function draw() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + pan.x, h / 2 + pan.y);
    ctx.scale(zoom, zoom);
    const positions = new Map(points.map((point) => [String(point.id), point]));
    ctx.lineWidth = 0.7 / Math.sqrt(zoom);
    for (const edge of graph.edges) {
      const a = positions.get(String(edge.source)),
        b = positions.get(String(edge.target));
      if (!a || !b) continue;
      const active =
        String(edge.source) === selected || String(edge.target) === selected;
      ctx.strokeStyle = active
        ? "rgba(227,194,128,.7)"
        : "rgba(171,147,98,.16)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let i = 0; i < points.length; i++) {
      const point = points[i],
        active = String(point.id) === selected,
        r = points.length > 400 ? 2.5 : 4;
      ctx.beginPath();
      ctx.arc(point.x, point.y, active ? r + 2 : r, 0, Math.PI * 2);
      ctx.fillStyle = active
        ? "#f2dba7"
        : ["#d6b775", "#9e8c68", "#b3a487", "#77746c"][i % 4];
      ctx.fill();
      if (active) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = "#d6b77555";
        ctx.stroke();
      }
      if (active || (points.length <= 70 && zoom > 0.75)) {
        ctx.font = "11px Segoe UI";
        ctx.fillStyle = active ? "#f0ddb5" : "#9e9b91";
        ctx.fillText(
          caption(point.label || point.id),
          point.x + 11,
          point.y + 4,
        );
      }
    }
    ctx.restore();
  }
  async function load(reset = false) {
    if (loading && !reset) return;
    const ticket = ++request;
    loading = true;
    $("golem-more").disabled = true;
    const pageOffset = reset ? 0 : offset,
      query = filter;
    try {
      let data = await api(
        "/api/golem/knowledge?" +
          new URLSearchParams({
            q: query,
            offset: String(pageOffset),
            limit: "150",
          }),
      );
      if (!data.nodes?.length && pageOffset === 0) {
        const local = await api("/api/graph");
        if (local.nodes?.length) {
          const matches = new Set(
            local.nodes
              .filter(
                (node) =>
                  !query ||
                  String(node.label || node.id)
                    .toLocaleLowerCase("ru")
                    .includes(query.toLocaleLowerCase("ru")),
              )
              .map((node) => String(node.id)),
          );
          const edges = local.edges.filter(
            (edge) =>
              matches.has(String(edge.source)) ||
              matches.has(String(edge.target)),
          );
          const ids = new Set([
            ...matches,
            ...edges.flatMap((edge) => [
              String(edge.source),
              String(edge.target),
            ]),
          ]);
          data = {
            nodes: local.nodes.filter((node) => ids.has(String(node.id))),
            edges,
            total: edges.length,
            source: "local-chat",
          };
        }
      }
      if (ticket !== request) return;
      if (reset) graph = { nodes: [], edges: [] };
      const nodes = new Map(graph.nodes.map((node) => [String(node.id), node])),
        edges = new Map(graph.edges.map((edge) => [String(edge.id), edge]));
      for (const node of data.nodes || []) nodes.set(String(node.id), node);
      for (const edge of data.edges || []) edges.set(String(edge.id), edge);
      graph = { nodes: [...nodes.values()], edges: [...edges.values()] };
      offset = pageOffset + (data.edges?.length || 0);
      total = data.total || 0;
      source = data.source || "local-chat";
      if (selected && !nodes.has(selected)) {
        selected = null;
        $("golem-selected").textContent = "Выберите узел";
        $("golem-source").replaceChildren();
      }
      $("graph-count").textContent = graph.nodes.length
        ? graph.nodes.length + " узлов · " + graph.edges.length + " связей"
        : "";
      updateInspectorVisibility();
      $("map-actions").hidden = !graph.nodes.length;
      $("golem-diagnostics").textContent = graph.nodes.length
        ? source === "postgresql"
          ? "Знания из базы"
          : "Связи из переписки"
        : "";
      $("graph-empty").hidden = graph.nodes.length > 0;
      $("graph-empty").querySelector("h2").textContent = query
        ? "Совпадений нет"
        : "У каждой мысли есть связи";
      $("graph-empty").querySelector("p").textContent = query
        ? "Измените запрос или сбросьте карту."
        : "После переписки здесь появится карта ваших знаний.";
      $("golem-more").disabled = source !== "postgresql" || offset >= total;
      $("golem-more").hidden = $("golem-more").disabled;
      layout();
    } catch (error) {
      if (ticket === request)
        $("golem-diagnostics").textContent = error.message;
    } finally {
      if (ticket === request) loading = false;
    }
  }
  function coords(event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - box.width / 2 - pan.x) / zoom,
      y: (event.clientY - box.top - box.height / 2 - pan.y) / zoom,
    };
  }
  function hit(point) {
    return points.find(
      (node) =>
        Math.hypot(node.x - point.x, node.y - point.y) < 11 / Math.sqrt(zoom),
    );
  }
  function inspect(node) {
    semanticVisible = false;
    $("golem-similar-results").replaceChildren();
    selected = String(node.id);
    updateInspectorVisibility();
    $("golem-selected").textContent = node.label || node.id;
    const edges = graph.edges.filter(
        (edge) =>
          String(edge.source) === selected || String(edge.target) === selected,
      ),
      target = $("golem-source");
    target.replaceChildren();
    document.querySelector(".inspector-hint").textContent = edges.length
      ? "Связей в этой области: " + edges.length
      : "У этого узла пока нет видимых связей.";
    for (const edge of edges.slice(0, 20)) {
      const fact = /^[1-9][0-9]*$/.test(String(edge.id)),
        item = document.createElement(fact ? "button" : "div");
      item.className = "source-link";
      if (fact) item.type = "button";
      const other = graph.nodes.find(
        (value) =>
          String(value.id) ===
          (String(edge.source) === selected
            ? String(edge.target)
            : String(edge.source)),
      );
      item.textContent =
        (edge.label ? edge.label + " · " : "") +
        (other?.label || other?.id || "Связь");
      if (fact)
        item.addEventListener("click", async () => {
          try {
            const value = await api(
              "/api/golem/source?id=" + encodeURIComponent(edge.id),
            );
            let detail = target.querySelector(".source-detail");
            if (!detail) {
              detail = document.createElement("div");
              detail.className = "source-detail";
              target.append(detail);
            }
            detail.replaceChildren();
            for (const text of [
              value.subject + " — " + value.predicate + " — " + value.object,
              (value.source === "cloudru-extracted"
                ? "Извлечено ИИ"
                : value.source === "user-confirmed"
                  ? "Подтверждено вами"
                  : "Источник: " + value.source) +
                " · " +
                UI.date(value.created_at),
              value.message?.content ||
                "Прямая ссылка на сообщение не сохранена.",
            ]) {
              const p = document.createElement("p");
              p.textContent = text;
              detail.append(p);
            }
          } catch (error) {
            notify(error.message, "error");
          }
        });
      target.append(item);
    }
    draw();
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
      node: hit(coords(event)),
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) {
      const node = hit(coords(event));
      canvas.title = node ? String(node.label || node.id) : "";
      return;
    }
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (drag.moved) {
      pan = { x: drag.panX + dx, y: drag.panY + dy };
      draw();
    }
  });
  canvas.addEventListener("pointerup", () => {
    if (drag?.node && !drag.moved) inspect(drag.node);
    drag = null;
  });
  canvas.addEventListener("pointercancel", () => (drag = null));
  function changeZoom(factor) {
    zoom = Math.max(0.25, Math.min(4, zoom * factor));
    canvas.setAttribute(
      "aria-label",
      "Карта связей. Масштаб " +
        Math.round(zoom * 100) +
        "%. Стрелки выбирают узел, Enter открывает сведения.",
    );
    draw();
  }
  $("graph-zoom-in").addEventListener("click", () => changeZoom(1.2));
  $("graph-zoom-out").addEventListener("click", () => changeZoom(1 / 1.2));
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      changeZoom(event.deltaY > 0 ? 0.9 : 1.1);
    },
    { passive: false },
  );
  canvas.addEventListener("keydown", (event) => {
    if (!points.length) return;
    if (
      ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)
    ) {
      event.preventDefault();
      const index = points.findIndex((point) => String(point.id) === selected),
        step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
      inspect(points[(index + step + points.length) % points.length]);
    }
    if (event.key === "Enter" && selected) {
      event.preventDefault();
      document.querySelector("#golem-source button")?.focus();
    }
  });
  $("graph-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    filter = $("golem-search").value.trim();
    void load(true);
  });
  $("graph-inspector-close").addEventListener("click", () => {
    semanticVisible = false;
    selected = null;
    $("golem-source").replaceChildren();
    $("golem-similar-results").replaceChildren();
    $("golem-selected").textContent = "Выберите узел";
    document.querySelector(".inspector-hint").textContent =
      "Нажмите на точку, чтобы увидеть её связи и источники.";
    updateInspectorVisibility();
    draw();
    canvas.focus();
  });
  $("graph-reset").addEventListener("click", () => {
    semanticVisible = false;
    selected = null;
    $("golem-selected").textContent = "Выберите узел";
    $("golem-source").replaceChildren();
    document.querySelector(".inspector-hint").textContent =
      "Нажмите на точку, чтобы увидеть её связи и источники.";
    $("golem-similar-results").replaceChildren();
    updateInspectorVisibility();
    changeZoom(1 / zoom);
    pan = { x: 0, y: 0 };
    filter = "";
    $("golem-search").value = "";
    void load(true);
  });
  $("golem-more").addEventListener("click", () => void load());
  $("golem-similar").addEventListener("click", async () => {
    const text = $("golem-search").value.trim();
    if (!text) {
      $("golem-search").focus();
      notify("Введите, что нужно найти");
      return;
    }
    const target = $("golem-similar-results"),
      button = $("golem-similar");
    button.disabled = true;
    target.replaceChildren();
    semanticVisible = true;
    selected = null;
    $("golem-source").replaceChildren();
    $("golem-selected").textContent = "Похожие воспоминания";
    document.querySelector(".inspector-hint").textContent = text;
    updateInspectorVisibility();
    const pending = document.createElement("li");
    pending.textContent = "Ищем воспоминания…";
    target.append(pending);
    try {
      const data = await api("/api/golem/similar", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      target.replaceChildren();
      for (const match of data.results) {
        const li = document.createElement("li");
        li.textContent = match.content;
        target.append(li);
      }
      if (!data.results.length) {
        const li = document.createElement("li");
        li.textContent = "Похожих воспоминаний пока нет.";
        target.append(li);
      }
    } catch (error) {
      target.replaceChildren();
      const li = document.createElement("li");
      li.textContent = error.message;
      target.append(li);
    } finally {
      button.disabled = false;
    }
  });
  new ResizeObserver(layout).observe(canvas);
  document.addEventListener("amayori-view", (event) => {
    if (event.detail.visiblePages?.includes("graph")) {
      requestAnimationFrame(layout);
      void load(true);
    }
  });
  document.addEventListener("amayori-chat-updated", () => {
    if (UI.isViewVisible("graph")) void load(true);
  });
  addEventListener("storage", (event) => {
    if (event.key === "amayori-chat-update" && UI.isViewVisible("graph"))
      void load(true);
  });
  setInterval(() => {
    if (
      !document.hidden &&
      UI.isViewVisible("graph") &&
      !filter &&
      source !== "postgresql"
    )
      void load(true);
  }, 12000);
  if (UI.isViewVisible("graph")) void load(true);
})();
