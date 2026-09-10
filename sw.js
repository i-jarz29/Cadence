/* Cadence service worker — makes the app open instantly and work with no signal.
 * The shell is cached; GitHub API calls always go to the network.
 * Bump CACHE when you change any shell file so devices pick the new version up. */

const CACHE = "cadence-shell-v3";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./sync.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache the API — it must be live.
  if (url.hostname === "api.github.com" || url.hostname.endsWith("githubusercontent.com")) return;

  // Same-origin shell: serve from cache fast, refresh in the background.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined));
        return hit || net;
      })
    );
  }
});
