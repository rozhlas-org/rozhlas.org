// Stamp the built service worker with a unique build id so its bytes change every
// deploy. The browser only treats a service worker as "new" (and runs install →
// activate) when sw.js is byte-different from the installed one; a static sw.js
// would never update, so old caches would never be cleared. Runs after `astro
// build` (see package.json). Uses the CI commit SHA when available, else a
// timestamp, so the same content reuses the same cache name.
import { readFileSync, writeFileSync } from "node:fs";

const version = (process.env.GITHUB_SHA ?? "").slice(0, 8) || String(Date.now());
const path = "dist/sw.js";
const stamped = readFileSync(path, "utf8").replaceAll("__BUILD__", version);
writeFileSync(path, stamped);
console.log(`stamped ${path} cache version: ${version}`);
