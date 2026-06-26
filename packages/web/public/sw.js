// rozhlas.org service worker. App shell: network-first for navigations (never
// stale after a deploy), cache-first for immutable hashed assets + fonts. Offline
// audio: requests to the IPFS gateway are served from the IndexedDB blob saved by
// offline.ts (range-capable via blob.slice) when the CID is downloaded, else from
// the network. The API is never cached.
// __BUILD__ is replaced with a unique id at build time (stamp-sw.ts). That makes
// THIS file's bytes change every deploy, so the browser detects a new SW and runs
// activate → which deletes every cache whose name !== CACHE, clearing the previous
// build's shell + assets. A static name would never invalidate, so a stale (or
// half-broken) cache could stick forever. Falls back to the literal in dev.
const CACHE = "rozhlas-shell-__BUILD__";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// --- offline audio: read the blob the page stored in IndexedDB (same DB as offline.ts) ---
const ODB = "rozhlas-offline";
function offlineAudioBlob(cid) {
  return new Promise((resolve) => {
    const r = indexedDB.open(ODB, 1);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("audio")) return resolve(null);
      const g = db.transaction("audio", "readonly").objectStore("audio").get(cid);
      g.onsuccess = () => resolve(g.result ? g.result.blob : null);
      g.onerror = () => resolve(null);
    };
    r.onerror = () => resolve(null);
    // Create the same schema the page uses, in case the SW opens the DB first (e.g.
    // serving cover art from the gateway) — otherwise it'd leave a store-less DB and
    // the page's same-version open could never add the stores.
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
      if (!db.objectStoreNames.contains("shows")) db.createObjectStore("shows");
    };
  });
}

// Serve a saved audio blob, honoring Range so the player can seek offline.
async function serveAudio(req, cid) {
  const blob = await offlineAudioBlob(cid);
  if (!blob) return fetch(req); // not downloaded → straight to the gateway
  const type = blob.type || "audio/mpeg";
  const range = req.headers.get("range");
  if (!range) {
    return new Response(blob, {
      status: 200,
      headers: { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(blob.size) },
    });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : blob.size - 1;
  if (start >= blob.size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${blob.size}` } });
  }
  end = Math.min(end, blob.size - 1);
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${blob.size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

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

  // IPFS audio gateway: serve a saved blob (offline) if we have it, else network.
  if (url.hostname === "ipfs.rozhlas.org") {
    const cid = url.pathname.split("/ipfs/")[1]?.split("/")[0];
    if (cid) e.respondWith(serveAudio(req, cid));
    return;
  }
  // The API is dynamic + cross-origin — never cache.
  if (url.hostname === "api.rozhlas.org") return;

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
