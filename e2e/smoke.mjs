// Browser regression tests: drives a real headless Chrome or Edge through the main flows, with no dependencies.
// Needs Node 22 or later (global WebSocket) and Chrome, Chromium or Edge. Run: node e2e/smoke.mjs
// Set CHROME to the browser's path if it isn't found. Not part of `node --test tests/` (that stays fast and offline).
import http from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
// never hang a build: give up (and fail) after three minutes
setTimeout(() => { console.log("FAIL the browser tests took longer than 3 minutes"); process.exit(1); }, 180_000).unref();
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg", ".txt": "text/plain", ".xml": "application/xml", ".md": "text/markdown" };

function findBrowser() {
  const candidates = [
    process.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error("No Chrome, Chromium or Edge found. Set the CHROME environment variable to its path.");
  return found;
}

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://x").pathname;
    const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
    if (!file.startsWith(root)) throw new Error("outside");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", etag: `"${body.length}"`, "cache-control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = await mkdtemp(join(tmpdir(), "tcb-e2e-"));
const browser = spawn(findBrowser(), [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--no-sandbox", "--disable-gpu", "about:blank",
], { stdio: "ignore" });

async function devtoolsPort() {
  for (let i = 0; i < 100; i++) {
    try {
      const text = await readFile(join(profile, "DevToolsActivePort"), "utf8");
      return Number(text.split("\n")[0]);
    } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("The browser didn't start.");
}
const port = await devtoolsPort();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let nextId = 1;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method === "Runtime.exceptionThrown") problems.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error" && !/favicon|sw\.js|ERR_INTERNET_DISCONNECTED/.test(msg.params.entry.url ?? "") && !/Failed to load resource/.test(msg.params.entry.text)) problems.push(`log: ${msg.params.entry.text}`);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

/** Run JS in the page (top-level await works) and return its value. */
async function run(expression) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}
async function open(path) {
  await send("Page.navigate", { url: `${base}${path}` });
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await run('return document.readyState === "complete" && !!document.querySelector("#layers li, #layers .empty")')) return;
  }
  throw new Error(`${path} did not finish loading`);
}
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`ok   ${name}`);
  } catch (e) {
    results.push([false, name]);
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}

const CRV = "Line:\t2\r\nColor:\tff00ff00\r\nShow:\t1\r\nType:\tTF\r\nTolerance:\t3.0000\r\nUseTolerance:\t0\r\n\r\n20.000000\t0.000000\r\n1000.000000\t3.000000\r\n20000.000000\t0.000000\r\n";

try {
  await test("loads cleanly: no errors, three group tabs, a curve and an enabled Export", async () => {
    await open("/?fresh");
    const r = await run(`await new Promise(r => setTimeout(r, 500));
      return { title: document.title, tabs: document.querySelectorAll(".tab").length, rows: document.querySelectorAll("#points-table tbody tr").length,
        export: !document.getElementById("btn-export").disabled, notice: document.getElementById("notice").hidden };`);
    assert.match(r.title, /Smaart/);
    assert.equal(r.tabs, 3);
    assert.ok(r.rows > 20);
    assert.ok(r.export);
    assert.deepEqual(problems, []);
  });

  await test("no sideways scrolling at phone, tablet-ish and desktop widths", async () => {
    for (const width of [375, 760, 1000, 1400]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
      await settle(300);
      const w = await run("return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };");
      assert.ok(w.sw <= w.cw + 1, `${width}px wide: scrollWidth ${w.sw} > clientWidth ${w.cw}`);
    }
    await send("Emulation.clearDeviceMetricsOverride");
  });

  await test("importing a .crv fills the curve, and the table matches the file", async () => {
    await open("/?fresh");
    const r = await run(`const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(CRV)}], "Room.crv"));
      const inp = document.getElementById("file-import"); inp.files = dt.files; inp.dispatchEvent(new Event("change"));
      await new Promise(r => setTimeout(r, 800));
      return { name: document.getElementById("p-name").value, rows: [...document.querySelectorAll("#points-table tbody tr")].map(t => t.textContent), colour: document.getElementById("p-color").value };`);
    assert.equal(r.name, "Room");
    assert.equal(r.rows.length, 3);
    assert.match(r.rows[1], /1000\.000000.*3\.000000/);
    assert.equal(r.colour, "#00ff00");
  });

  await test("editing a number, bad input, and Undo leave the box and the document in step", async () => {
    await open("/?fresh");
    const r = await run(`const tol = document.getElementById("p-tol");
      tol.value = "5"; tol.dispatchEvent(new Event("input", { bubbles: true })); await new Promise(r => setTimeout(r, 100));
      document.getElementById("btn-undo").click(); await new Promise(r => setTimeout(r, 200));
      const afterUndo = tol.value;
      tol.value = "abc"; tol.dispatchEvent(new Event("input", { bubbles: true })); const invalid = tol.getAttribute("aria-invalid");
      tol.dispatchEvent(new Event("blur"));
      return { afterUndo, invalid, afterBlur: tol.value };`);
    assert.deepEqual(r, { afterUndo: "3", invalid: "true", afterBlur: "3" });
  });

  await test("a shared link opens on a blank page, and asks first when a curve is open", async () => {
    await open("/?fresh");
    const r = await run(`const share = await import("/js/share.js"); const doc = await import("/js/doc.js");
      const a = doc.newDoc(); a.props.name = "From link A"; const b = doc.newDoc(); b.props.name = "From link B";
      location.hash = "d=" + await share.encodeShare(a); await new Promise(r => setTimeout(r, 700));
      const first = { name: document.getElementById("p-name").value, hash: location.hash, dialog: document.getElementById("dlg-link").open };
      location.hash = "d=" + await share.encodeShare(b); await new Promise(r => setTimeout(r, 700));
      const second = { name: document.getElementById("p-name").value, dialog: document.getElementById("dlg-link").open };
      document.getElementById("link-keep").click(); await new Promise(r => setTimeout(r, 200));
      const kept = document.getElementById("p-name").value;
      location.hash = "d=" + await share.encodeShare(b); await new Promise(r => setTimeout(r, 700));
      document.getElementById("link-open").click(); await new Promise(r => setTimeout(r, 300));
      return { first, second, kept, opened: document.getElementById("p-name").value, bad: (location.hash = "d=%%%", 1) };`);
    assert.deepEqual(r.first, { name: "From link A", hash: "", dialog: false });
    assert.deepEqual(r.second, { name: "From link A", dialog: true });
    assert.equal(r.kept, "From link A");
    assert.equal(r.opened, "From link B");
  });

  await test("a broken autosave doesn't stop the page, a good one is restored, and ?fresh forgets it", async () => {
    // plant the bad value as each new page starts (the previous page writes its own autosave as it closes)
    const planted = await send("Page.addScriptToEvaluateOnNewDocument", { source: 'localStorage.setItem("tcb-autosave", "{not json")' });
    await open("/");
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: planted.identifier });
    assert.equal(await run('return document.getElementById("p-name").value'), "Target curve");
    await run(`const n = document.getElementById("p-name"); n.value = "Saved one"; n.dispatchEvent(new Event("input", { bubbles: true })); await new Promise(r => setTimeout(r, 600));`);
    await open("/");
    assert.equal(await run('return document.getElementById("p-name").value'), "Saved one");
    await open("/?fresh");
    assert.equal(await run('return document.getElementById("p-name").value'), "Target curve");
  });

  await test("the hover readout shows the wavelength and the table never does", async () => {
    await open("/?fresh");
    const r = await run(`const svg = document.getElementById("plot"); const b = svg.getBoundingClientRect();
      for (const T of [PointerEvent, MouseEvent]) svg.dispatchEvent(new T(T === PointerEvent ? "pointermove" : "mousemove", { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, pointerType: "mouse" }));
      await new Promise(r => setTimeout(r, 200));
      return { readout: [...svg.querySelectorAll("text")].map(t => t.textContent).find(t => /Hz.*dB.*\\b(m|cm|mm)$/.test(t)) ?? null, cols: [...document.querySelectorAll("#points-table th")].map(t => t.textContent) };`);
    assert.ok(r.readout, "a readout with a wavelength");
    assert.deepEqual(r.cols, ["Hz", "dB"]);
  });

  await test("About opens as a pop-out and closes again", async () => {
    await open("/?fresh");
    const r = await run(`const d = document.getElementById("dlg-about"); const before = d.open;
      document.getElementById("btn-about").click(); const opened = d.open; const text = d.textContent.includes("Smaart target curve");
      document.getElementById("btn-about-close").click();
      return { before, opened, text, after: d.open };`);
    assert.deepEqual(r, { before: false, opened: true, text: true, after: false });
  });

  await test("works offline once loaded (service worker)", async () => {
    await open("/?fresh");
    const ready = await run(`const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 8000))]);
      if (!reg) return false;
      for (let i = 0; i < 50 && !(await caches.keys()).length; i++) await new Promise(r => setTimeout(r, 100));
      return (await caches.keys()).length > 0;`);
    assert.ok(ready, "service worker active with a cache");
    await send("Network.enable");
    await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await send("Page.reload", { ignoreCache: true });
    let loaded = false;
    for (let i = 0; i < 60 && !loaded; i++) {
      await settle(150);
      try { loaded = await run('return !!document.querySelector("#layers li") && document.getElementById("points-table").tBodies[0].rows.length > 5;'); } catch { /* still loading */ }
    }
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    assert.ok(loaded, "the page loaded and drew a curve with no network");
  });

  await test("nothing was logged as an error along the way", async () => {
    assert.deepEqual(problems, []);
  });
} finally {
  ws.close();
  browser.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} browser tests passed`);
process.exit(failed ? 1 : 0);
