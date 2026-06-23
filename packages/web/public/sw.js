// rozhlas.org service worker — app-shell only. Network-first for navigations so a
// deploy is never stale; cache-first for Astro's immutable hashed assets + fonts.
// The API (api.rozhlas.org) and IPFS audio (ipfs.rozhlas.org) are never cached.
const CACHE = "rozhlas-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache the API or the IPFS audio gateway — straight to network.
  if (url.hostname === "api.rozhlas.org" || url.hostname === "ipfs.rozhlas.org") return;

  // Google Fonts (cross-origin, versioned URLs) — cache-first.
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Navigations (deep routes resolve via 404.html → the same shell): network-first,
  // fall back to the precached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req));
    return;
  }
  // Own static assets (Astro hashes /_astro/* → immutable) — cache-first.
  e.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      (await caches.open(CACHE)).put(req, res.clone());
    }
    return res;
  } catch {
    return cached || Response.error();
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) (await caches.open(CACHE)).put("/", res.clone()); // keep the shell fresh
    return res;
  } catch {
    return (await caches.match(req)) || (await caches.match("/")) || Response.error();
  }
}
