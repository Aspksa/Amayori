// Browser-local navigation only: these preferences never change stored knowledge.
(() => {
  const key = (value) => String(value).normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  function normalize(value) {
    const pinned = [], seen = new Set();
    if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.pinned)) {
      for (const path of value.pinned) {
        if (typeof path !== "string" || !path.trim() || path.length > 100 || /[\u0000-\u001f]/u.test(path)) continue;
        const id = key(path);
        if (seen.has(id)) continue;
        seen.add(id);
        pinned.push(path.trim());
        if (pinned.length === 200) break;
      }
    }
    return {version: 1, pinned};
  }
  const isPinned = (prefs, path) => normalize(prefs).pinned.some(item => key(item) === key(path));
  function toggle(prefs, path) {
    const next = normalize(prefs);
    next.pinned = isPinned(next, path)
      ? next.pinned.filter(item => key(item) !== key(path))
      : [...next.pinned, path];
    return normalize(next);
  }
  function select(overview, {query = "", filter = "all", prefs} = {}) {
    const pinned = new Set(normalize(prefs).pinned.map(key));
    const folders = new Map(overview.folders.map(folder => [folder.path, folder]));
    const roots = overview.roots.map(path => folders.get(path)).filter(Boolean);
    const terms = key(query).slice(0, 200).split(" ").filter(Boolean);
    const matches = path => terms.every(term => key(path).includes(term));
    const rows = roots.map(folder => ({...folder,
      pinned: pinned.has(key(folder.path)),
      matchedChildren: terms.length ? folder.children.filter(matches) : [],
    })).filter(folder =>
      (filter !== "pinned" || folder.pinned) &&
      (filter !== "attention" || folder.attention > 0) &&
      (!terms.length || matches(folder.path) || folder.matchedChildren.length > 0)
    ).sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return {rows, counts: {
      all: roots.length,
      pinned: roots.filter(folder => pinned.has(key(folder.path))).length,
      attention: roots.filter(folder => folder.attention > 0).length,
    }};
  }
  globalThis.AmayoriTopicNavigation = Object.freeze({normalize, isPinned, toggle, select});
})();
