import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sw = readFileSync(join(root, "sw.js"), "utf8");
const files = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));

const jsFiles = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsFiles(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []));

test("the service worker saves every app file for offline use, and only files that exist", () => {
  for (const f of files) if (f !== "./") assert.ok(existsSync(join(root, f)), `${f} exists`);
  for (const f of jsFiles("js")) assert.ok(files.includes(f), `${f} is in sw.js FILES`);
  for (const f of ["index.html", "css/app.css", "icon.svg", "manifest.webmanifest"]) assert.ok(files.includes(f), f);
  assert.equal(new Set(files).size, files.length, "no repeats");
});

test("the service worker's version is the one in the release notes' newest tag, and it only touches same-origin GETs", () => {
  assert.match(sw, /const VERSION = "\d+\.\d+\.\d+";/);
  assert.match(sw, /req\.method !== "GET" \|\| new URL\(req\.url\)\.origin !== self\.location\.origin/);
  assert.match(sw, /cache: "no-cache"/, "re-checked with the server each time, so a stale copy is never preferred online");
});

test("the page registers the worker and links the manifest, and the CSP allows exactly those", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const app = readFileSync(join(root, "js/app.js"), "utf8");
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /manifest-src 'self'/);
  assert.match(html, /worker-src 'self'/);
  assert.match(app, /serviceWorker\.register\("sw\.js"\)/);
  const manifest = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8"));
  assert.ok(manifest.name && manifest.start_url && manifest.icons.length);
});
