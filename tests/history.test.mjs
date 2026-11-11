import test from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../js/history.js";
import { getPref, setPref } from "../js/prefs.js";
import * as presets from "../js/presets.js";
import { newDoc } from "../js/doc.js";

test("history: record, undo, redo, and a new edit clears redo", () => {
  const h = createHistory({ start: "a" });
  assert.equal(h.record("a", null, 0), false, "no change, no step");
  assert.equal(h.record("b", null, 0), true);
  assert.equal(h.record("c", null, 1), true);
  assert.deepEqual([h.canUndo(), h.canRedo(), h.current()], [true, false, "c"]);
  assert.equal(h.undo(), "b");
  assert.equal(h.undo(), "a");
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), "b");
  assert.equal(h.record("x", null, 2), true);
  assert.equal(h.canRedo(), false, "a new edit drops the redo steps");
  assert.equal(h.undo(), "b");
});

test("history: edits of one control within the window are one step, a different control or a later edit is a new one", () => {
  const h = createHistory({ start: "0", coalesceMs: 800 });
  h.record("1", "tol", 100);
  h.record("2", "tol", 400);
  h.record("3", "tol", 900); // within 800 ms of the last edit (400): still merged
  assert.equal(h.undo(), "0", "all three were one step");
  assert.equal(h.undo(), null);
  const g = createHistory({ start: "0", coalesceMs: 800 });
  g.record("1", "tol", 0);
  g.record("2", "tol", 2000); // too late
  g.record("3", "name", 2100); // another control
  g.record("4", null, 2200); // no key: never merged
  g.record("5", null, 2201);
  assert.deepEqual([g.undo(), g.undo(), g.undo(), g.undo(), g.undo(), g.undo()], ["4", "3", "2", "1", "0", null]);
});

test("history: undo does not merge with the next edit, and the oldest steps fall off at the limit", () => {
  const h = createHistory({ start: "0", max: 3 });
  for (let i = 1; i <= 6; i++) h.record(String(i), null, i);
  assert.deepEqual([h.undo(), h.undo(), h.undo(), h.undo()], ["5", "4", "3", null]);
  const k = createHistory({ start: "0" });
  k.record("1", "a", 0);
  k.undo();
  k.record("2", "a", 10); // right after an undo, within the window: still its own step
  assert.equal(k.undo(), "0");
  const adopted = createHistory({ start: "0" });
  adopted.adopt("fresh");
  assert.equal(adopted.current(), "fresh");
  assert.equal(adopted.canUndo(), false);
});

test("prefs: reads and writes survive a throwing or missing localStorage", () => {
  assert.equal(getPref("x"), null, "no localStorage in Node");
  setPref("x", "1"); // must not throw
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, String(v)); } };
  setPref("a", "b");
  assert.equal(getPref("a"), "b");
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(getPref("a"), null);
  setPref("a", "c");
  delete globalThis.localStorage;
});

test("presets: a saved preset leaves the reference trace out, and a full or blocked store is told apart", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  const d = newDoc();
  d.template = { name: "t", points: [[20, 1], [200, 2]], offset: 0, smooth: 0, normalise: false, show: true };
  assert.equal(presets.savePreset("p", d), true);
  assert.equal("template" in JSON.parse(store.get("tcb-presets")).p, false);
  assert.equal(presets.storageFailure(), null);
  assert.ok(d.template, "the document being edited keeps its trace");
  globalThis.localStorage.setItem = () => { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; };
  assert.equal(presets.autosave("{}"), false);
  assert.equal(presets.storageFailure(), "full");
  assert.match(presets.storageProblemText(), /full/);
  globalThis.localStorage.setItem = () => { throw new Error("denied"); };
  assert.equal(presets.autosave("{}"), false);
  assert.equal(presets.storageFailure(), "blocked");
  assert.match(presets.storageProblemText(), /blocking/);
  presets.clearAutosave();
  delete globalThis.localStorage;
  presets.clearAutosave(); // no storage at all: still fine
});
