import test from "node:test";
import assert from "node:assert/strict";
import "../public/workspace-prefs.js";
const P = globalThis.AmayoriWorkspacePrefs;

test("invalid stored workspace data restores readable defaults", () => {
  for (const value of [null, 42, [], false, "bad"])
    assert.deepEqual(P.normalize(value), P.defaults());
  const value = P.normalize({
    navigation: {
      order: ["graph", "graph", "javascript:alert(1)", "chat"],
      pinned: ["graph", "unknown", "graph"],
    },
    split: {
      enabled: "yes",
      target: "settings",
      chatSide: "outside",
      share: Infinity,
    },
  });
  assert.deepEqual(value.navigation, {
    order: ["graph", "chat", "memory", "golem"],
    pinned: ["graph"],
  });
  assert.deepEqual(value.split, P.defaults().split);
});
test("an empty pinned list is valid while all sections remain reachable through More", () => {
  const value = P.normalize({ navigation: { pinned: [] } });
  assert.deepEqual(value.navigation.pinned, []);
  assert.deepEqual(value.navigation.order, P.sections);
});
test("pane proportions are bounded without accepting malformed types", () => {
  assert.equal(P.normalize({ split: { share: 5 } }).split.share, 35);
  assert.equal(P.normalize({ split: { share: 900 } }).split.share, 65);
  assert.equal(P.normalize({ split: { share: 55.5 } }).split.share, 56);
  assert.equal(P.normalize({ split: { share: "55" } }).split.share, 50);
});
test("split layout reuses one chat with the selected context and respects full-screen sections", () => {
  const value = P.defaults();
  value.split.enabled = true;
  value.split.target = "archive";
  assert.deepEqual(P.layout(value, "chat").visiblePages, ["chat", "memory"]);
  assert.deepEqual(P.layout(value, "graph").visiblePages, ["chat", "graph"]);
  assert.deepEqual(P.layout(value, "memory", "archive").visiblePages, [
    "chat",
    "memory",
  ]);
  for (const [page, tab] of [
    ["settings", "appearance"],
    ["memory", "facts"],
    ["memory", "quality"],
  ]) {
    const layout = P.layout(value, page, tab);
    assert.equal(layout.split, false);
    assert.deepEqual(layout.visiblePages, [page]);
  }
  value.split.enabled = false;
  assert.deepEqual(P.layout(value, "graph").visiblePages, ["graph"]);
});
test("reordering does not duplicate or discard sections and does not mutate its input", () => {
  const initial = [...P.sections];
  assert.deepEqual(P.move(initial, "graph", 0), [
    "graph",
    "chat",
    "memory",
    "golem",
  ]);
  assert.deepEqual(initial, P.sections);
  assert.deepEqual(P.move(initial, "unknown", 0), initial);
  assert.deepEqual(P.move(initial, "chat", 99), [
    "memory",
    "graph",
    "golem",
    "chat",
  ]);
});
