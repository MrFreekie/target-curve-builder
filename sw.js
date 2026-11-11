// Service worker: lets the app open with no network (a venue with poor Wi-Fi), and keeps a stale copy from ever
// being used while the network is there. Everything is same-origin; nothing is sent anywhere.
//
// Strategy: network first, re-checked with the server every time (cache: "no-cache"), falling back to the last
// good copy when offline. The first visit also saves the whole app, so a second visit works with no network at all.
// When you change any file below or add a module, add it to FILES (tests/sw.test.mjs checks the list is complete)
// and change VERSION for a release.
const VERSION = "1.1.0";
const CACHE = `tcb-${VERSION}`;
const FILES = [
  "./",
  "index.html",
  "css/app.css",
  "icon.svg",
  "manifest.webmanifest",
  "js/app.js",
  "js/bandwidth.js",
  "js/build.js",
  "js/colour.js",
  "js/curve.js",
  "js/doc.js",
  "js/eq.js",
  "js/formats/index.js",
  "js/formats/plain-text.js",
  "js/formats/smaart-ascii.js",
  "js/formats/smaart.js",
  "js/history.js",
  "js/layers.js",
  "js/naming.js",
  "js/pitch.js",
  "js/plot.js",
  "js/prefs.js",
  "js/presets.js",
  "js/share.js",
  "js/trace.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tcb-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});
