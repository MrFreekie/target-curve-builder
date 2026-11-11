import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, visibleLayers, layerGhosts, totalDb, keyFrequencies } from "../js/curve.js";
import { newDoc, newLayer, loadDoc, defaultGroups, GROUP_COUNT, isBlank, addImportedLayer } from "../js/doc.js";
import { suggestName } from "../js/naming.js";
import { buildCrv } from "../js/app.js";
import { validateTf } from "../js/formats/smaart.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const layer = (d, k) => d.layers.find((l) => l.kind === k);

/** A document with a tilt in group 1, an HPF in group 2, a bell in group 3 and a gain with no group. */
function sample() {
  const d = newDoc();
  d.grid.fraction = 3;
  Object.assign(layer(d, "lfTilt"), { on: true, group: 1 });
  Object.assign(layer(d, "hpf"), { on: true, group: 2 });
  d.layers.push({ ...newLayer("bell"), group: 3 });
  const loose = { ...newLayer("gain"), db: 2 };
  delete loose.group; // a raw layer with no group is still tolerated by the maths, and is never hidden
  d.layers.push(loose);
  return d;
}

test("a new document has three groups named A, B and C, all shown; layers start in group A", () => {
  const d = newDoc();
  assert.equal(GROUP_COUNT, 3);
  assert.deepEqual(d.groups, [{ name: "A", on: true }, { name: "B", on: true }, { name: "C", on: true }]);
  assert.ok(d.layers.every((l) => l.group === 1));
  assert.equal(newLayer("bell").group, 1);
  assert.deepEqual(defaultGroups(), d.groups);
  assert.equal(isBlank(d), true);
});

test("hiding a group removes exactly its layers from the curve; others and ungrouped layers stay", () => {
  const d = sample();
  const full = Object.fromEntries(evaluate(d));
  const only = (keep) => {
    const x = JSON.parse(JSON.stringify(d));
    x.layers = x.layers.filter((l) => keep(l));
    return Object.fromEntries(evaluate(x));
  };
  for (const n of [1, 2, 3]) {
    const hidden = JSON.parse(JSON.stringify(d));
    hidden.groups[n - 1].on = false;
    const expected = only((l) => l.group !== n);
    for (const [f, g] of evaluate(hidden)) assert.equal(g, expected[f], `group ${n} hidden, ${f} Hz`);
    assert.notDeepEqual(evaluate(hidden), evaluate(d));
  }
  // hiding every group leaves only the ungrouped layer: the 2 dB gain
  const none = JSON.parse(JSON.stringify(d));
  none.groups.forEach((g) => { g.on = false; });
  assert.ok(evaluate(none).every(([, g]) => g === 2));
  assert.ok(Object.keys(full).length > 0);
});

test("independent: any combination of groups shown or hidden works, each equal to that subset of layers", () => {
  const d = sample();
  for (let mask = 0; mask < 8; mask++) {
    const x = JSON.parse(JSON.stringify(d));
    x.groups.forEach((g, i) => { g.on = !!(mask & (1 << i)); });
    const subset = JSON.parse(JSON.stringify(d));
    subset.layers = subset.layers.filter((l) => !l.group || x.groups[l.group - 1].on);
    assert.deepEqual(evaluate(x), evaluate(subset), `mask ${mask}`);
  }
});

test("a layer's own switch and its group both count; the on flag is not changed by a group", () => {
  const d = sample();
  layer(d, "hpf").on = false;
  const a = evaluate(d);
  d.groups[1].on = false;
  assert.deepEqual(evaluate(d), a, "an off layer in a hidden group is still just off");
  d.groups[1].on = true;
  layer(d, "hpf").on = true;
  assert.equal(layer(d, "hpf").on, true);
  assert.equal(layer(d, "hpf").group, 2);
});

test("visibleLayers: no groups, a missing group, or a bad group number never hides a layer", () => {
  const layers = [{ kind: "gain", on: true, db: 1 }, { kind: "gain", on: true, db: 1, group: 1 }, { kind: "gain", on: true, db: 1, group: 9 }, { kind: "gain", on: true, db: 1, group: "1" }];
  assert.equal(visibleLayers({ layers }).length, 4);
  assert.equal(visibleLayers({ layers, groups: [] }).length, 4);
  assert.equal(visibleLayers({ layers, groups: [{ on: false }] }).length, 3);
  assert.equal(visibleLayers({ layers, groups: [{ on: true }] }).length, 4);
  assert.equal(visibleLayers({ layers, groups: [{}] }).length, 4, "on missing counts as shown");
});

test("ghosts, name suggestion, breakpoint corners and export checks all ignore hidden groups", () => {
  const d = sample();
  const ghostsAll = layerGhosts(d).map((g) => g.kind);
  assert.ok(ghostsAll.includes("bell"));
  d.groups[2].on = false;
  assert.ok(!layerGhosts(d).some((g) => g.kind === "bell"));
  assert.equal(layerGhosts(d).length, ghostsAll.length - 1);
  assert.ok(!suggestName(d).includes("Bell"));
  d.groups[2].on = true;
  assert.ok(suggestName(d).includes("Bell"));
  // an invalid layer in a hidden group no longer blocks export
  const bad = sample();
  bad.layers.push({ id: "x", kind: "hpf", on: true, fc: 50, type: "LR", slope: 18, group: 3 });
  assert.equal(buildCrv(bad).text, null);
  bad.groups[2].on = false;
  assert.ok(buildCrv(bad).text, JSON.stringify(buildCrv(bad).issues));
  assert.deepEqual(validateTf(bad, buildCrv(bad).points).filter((i) => i.level === "error"), []);
  // breakpoints: a hidden layer's corners are not in the dense grid
  const s = sample();
  s.layers.push({ ...newLayer("shape"), shape: "box", fc: 1234, width: 1, group: 2 });
  s.grid = { mode: "simplified", fmin: 20, fmax: 20000, epsilon: 0.05 };
  const near = (pts, f) => pts.some(([x]) => Math.abs(x / f - 1) < 1e-6);
  assert.ok(near(evaluate(s), 1234 * 2 ** -0.5), "box edge present while shown");
  s.groups[1].on = false;
  assert.ok(!near(evaluate(s), 1234 * 2 ** -0.5), "gone while hidden");
});

test("hidden-group layers don't change the total: totalDb of visible layers equals evaluate", () => {
  const d = sample();
  d.groups[0].on = false;
  const vis = visibleLayers(d);
  for (const [f, g] of evaluate(d)) close(g, Math.round(totalDb(f, vis) * 1e6) / 1e6, 1e-6, `${f}`);
  assert.equal(keyFrequencies(vis).length > 0, true);
});

test("groups, their names and states, and each layer's group survive save and load", () => {
  const d = sample();
  d.groups = [{ name: "Target", on: true }, { name: "Voicing", on: false }, { name: "Fix", on: true }];
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.groups, d.groups);
  assert.deepEqual(back.layers.map((l) => l.group), d.layers.map((l) => l.group ?? 1));
  assert.deepEqual(evaluate(back), evaluate(d));
});

test("loading: old documents get default groups; bad names and numbers are cleaned or dropped", () => {
  const old = loadDoc({ version: 1, layers: [{ kind: "gain", on: true, db: 3 }] });
  assert.deepEqual(old.groups, defaultGroups());
  assert.equal(old.layers[0].group, 1, "a layer with no group loads into group A");
  const odd = loadDoc({
    version: 1,
    groups: [{ name: "x\r\ny\tz".repeat(10), on: false }, { name: "", on: "no" }, "junk", { name: 5 }],
    layers: [0, 1, 3, 4, -1, 1.5, "2", null, true].map((group) => ({ kind: "gain", on: true, db: 1, group })),
  });
  assert.equal(odd.groups.length, 3);
  assert.ok(odd.groups[0].name.length <= 24 && !/[\r\n\t]/.test(odd.groups[0].name));
  assert.equal(odd.groups[0].on, false);
  assert.deepEqual(odd.groups[1], { name: "B", on: true });
  assert.deepEqual(odd.groups[2], { name: "C", on: true });
  assert.deepEqual(odd.layers.map((l) => l.group), [1, 1, 3, 1, 1, 1, 1, 1, 1]);
  assert.equal(loadDoc({ version: 1, layers: [], groups: [{ name: "__proto__" }, { name: "constructor" }] }).groups[0].name, "__proto__");
});

test("renaming or hiding a group makes the document no longer blank; adding a file leaves the groups alone", () => {
  const d = newDoc();
  d.groups[0].name = "Mine";
  assert.equal(isBlank(d), false);
  const e = newDoc();
  e.groups[1].on = false;
  assert.equal(isBlank(e), false);
  const base = sample();
  base.groups[0].on = false;
  const { doc } = addImportedLayer(base, "Line:\t3\r\nType:\tTF\r\n\r\n100\t0\r\n200\t3\r\n", "f.crv");
  assert.deepEqual(doc.groups, base.groups);
  assert.equal(doc.layers.at(-1).group, 1, "an added layer starts in group A");
});

test("only groups 1 to 3 can hide a layer, even when a raw document has a longer groups list", () => {
  const layers = [4, 5, 0, -1].map((group) => ({ kind: "gain", on: true, db: 1, group }));
  const groups = [{ on: true }, { on: true }, { on: true }, { on: false }, { on: false }];
  assert.equal(visibleLayers({ layers, groups }).length, 4);
});
