// Shared validation for browser-local layout preferences. Also usable in Node tests.
(() => {
  const sections = Object.freeze(["chat", "memory", "graph", "golem"]);
  const defaults = () => ({
    version: 1,
    navigation: { order: [...sections], pinned: [...sections] },
    split: { enabled: false, target: "graph", chatSide: "right", share: 50 },
  });
  function normalize(value) {
    const result = defaults();
    if (!value || typeof value !== "object" || Array.isArray(value))
      return result;
    const nav = value.navigation;
    if (nav && typeof nav === "object") {
      if (Array.isArray(nav.order))
        result.navigation.order = [
          ...new Set([
            ...nav.order.filter((id) => sections.includes(id)),
            ...sections,
          ]),
        ];
      if (Array.isArray(nav.pinned))
        result.navigation.pinned = result.navigation.order.filter((id) =>
          nav.pinned.includes(id),
        );
    }
    const split = value.split;
    if (split && typeof split === "object") {
      result.split.enabled = split.enabled === true;
      if (["graph", "archive"].includes(split.target))
        result.split.target = split.target;
      if (["left", "right"].includes(split.chatSide))
        result.split.chatSide = split.chatSide;
      if (typeof split.share === "number" && Number.isFinite(split.share))
        result.split.share = Math.round(
          Math.max(35, Math.min(65, split.share)),
        );
    }
    return result;
  }
  function layout(value, page, tab) {
    const prefs = normalize(value);
    let content = prefs.split.target;
    const compatible =
      page === "chat" ||
      page === "graph" ||
      (page === "memory" && (!tab || tab === "archive"));
    const split = prefs.split.enabled && compatible;
    if (page === "graph") content = "graph";
    if (page === "memory") content = "archive";
    return {
      split,
      content,
      visiblePages: split
        ? ["chat", content === "archive" ? "memory" : "graph"]
        : [page],
    };
  }
  function move(order, id, index) {
    const valid = normalize({ navigation: { order } }).navigation.order;
    if (!valid.includes(id) || !Number.isInteger(index)) return valid;
    const next = valid.filter((value) => value !== id);
    next.splice(Math.max(0, Math.min(next.length, index)), 0, id);
    return next;
  }
  globalThis.AmayoriWorkspacePrefs = Object.freeze({
    sections,
    defaults,
    normalize,
    layout,
    move,
  });
})();
