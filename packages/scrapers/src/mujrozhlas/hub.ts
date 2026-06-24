import type { ScrapeCtx } from "../types.ts";
import type { ApiShowRef } from "./index.ts";

// Enumerate the show UUIDs under a station "hub" (category listing like
// /hry-a-cetba or /pribehy) that the JSON:API can't filter directly. We crawl the
// hub's listing pages for sub-pages, then resolve each to its mujRozhlas show UUID
// (the page embeds it) and confirm via /shows/<uuid>. The episode bulk then comes
// from the API (cheap). Bounded by ctx.signal + a fetch cap so it always ends.

const UA = "Mozilla/5.0 (compatible; rozhlas-org-bot/0.1; +https://github.com/rozhlas-org/rozhlas.org)";
const ACCEPT_JSON = "application/vnd.api+json";
const PER_FETCH_MS = 10_000; // fail a hung fetch fast so the crawl keeps moving
const DEFAULT_MAX_FETCHES = 4000;
const MAX_HUB_PAGES = 80;
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS ?? 150);
// Concurrency for resolving candidate pages (these stations don't throttle like Dvojka).
const CONCURRENCY = 12;

const NAV =
  /^\/(o-|kontakt|program|audioarchiv|kamery|playlisty|lide|dokumenty|hudba|video|page|tag|kategorie|moderator|porady|podcast|zive)\b/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface HubConfig {
  origin: string; // e.g. "https://vltava.rozhlas.cz"
  seeds: string[]; // hub paths, e.g. ["/hry-a-cetba"]
  maxPages?: number;
}

function combinedSignal(ctx: ScrapeCtx): AbortSignal {
  const t = AbortSignal.timeout(PER_FETCH_MS);
  return ctx.signal ? AbortSignal.any([ctx.signal, t]) : t;
}

/**
 * Race a promise against a hard deadline. The AbortSignal on fetch() does NOT
 * reliably abort a hung *body read* (res.text()/res.json()) in Bun, which can wedge
 * the whole crawl — so we time the body read out explicitly.
 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("body read timeout")), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), deadline]);
}

async function getText(ctx: ScrapeCtx, url: string): Promise<string> {
  const res = await ctx.fetch(url, { headers: { "user-agent": UA }, signal: combinedSignal(ctx) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return withDeadline(res.text(), PER_FETCH_MS);
}

/** Return the show title if `uuid` is a mujRozhlas show, else null. */
async function showTitle(ctx: ScrapeCtx, uuid: string): Promise<string | null> {
  try {
    const res = await ctx.fetch(`https://api.mujrozhlas.cz/shows/${uuid}`, {
      headers: { accept: ACCEPT_JSON },
      signal: combinedSignal(ctx),
    });
    if (!res.ok) return null;
    const j: any = await withDeadline(res.json(), PER_FETCH_MS);
    return j?.data?.type === "show" ? (j.data.attributes?.title ?? uuid) : null;
  } catch {
    return null;
  }
}

/** Top-N most-frequent UUIDs on a page (the show uuid recurs; episode/related ones don't). */
function topUuids(html: string, n: number): string[] {
  const counts = new Map<string, number>();
  for (const u of html.match(UUID_RE) ?? []) counts.set(u, (counts.get(u) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([u]) => u);
}

export interface HubEnumeration {
  shows: ApiShowRef[];
  /** False if the crawl was aborted (watchdog) or hit the fetch cap — i.e. partial, so the
   *  caller must NOT overwrite a good cache with it. */
  complete: boolean;
}

export async function enumerateShows(ctx: ScrapeCtx, hub: HubConfig): Promise<HubEnumeration> {
  const abs = (u: string) => (u.startsWith("http") ? u : hub.origin + u);
  const hostRe = hub.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkRe = new RegExp(`href="((?:${hostRe})?\\/[a-z0-9-]+-\\d{5,})`, "g");
  const maxPages = hub.maxPages ?? MAX_HUB_PAGES;
  const maxFetches = ctx.maxFetches ?? DEFAULT_MAX_FETCHES;

  const found = new Map<string, string>(); // show uuid -> title
  const tried = new Set<string>();
  const visited = new Set<string>();
  let fetches = 0;
  const beat = () => ctx.onProgress?.({ found: found.size, fetched: fetches });
  const budgetLeft = () => !ctx.signal?.aborted && fetches < maxFetches;

  // 1) collect candidate sub-pages across hub seeds + ?page=N pagination
  const candidates = new Set<string>();
  for (const seed of hub.seeds) {
    for (let page = 1; page <= maxPages && budgetLeft(); page++) {
      const base = abs(seed);
      const url = page === 1 ? base : `${base}${base.includes("?") ? "&" : "?"}page=${page}`;
      if (visited.has(url)) break;
      visited.add(url);
      if (fetches++ > 0) await sleep(DELAY_MS);
      let html: string;
      try {
        html = await getText(ctx, url);
      } catch {
        break;
      }
      beat();
      let added = 0;
      for (const m of html.matchAll(linkRe)) {
        const path = m[1]!.replace(hub.origin, "");
        if (!NAV.test(path)) {
          const a = abs(path);
          if (!candidates.has(a)) {
            candidates.add(a);
            added++;
          }
        }
      }
      if (added === 0) break; // end of listing
    }
  }

  // 2) resolve each candidate page to its show uuid (the most-frequent uuids).
  // Bounded concurrency — a large hub (cetba ~800 candidates) resolved sequentially
  // burns the whole job watchdog before any episodes load. The page fetch is the
  // cost; a uuid that's already a known show skips the API lookup.
  const queue = [...candidates];
  let qi = 0;
  const worker = async () => {
    while (qi < queue.length && budgetLeft()) {
      const url = queue[qi++]!;
      fetches++;
      let html: string;
      try {
        html = await getText(ctx, url);
      } catch {
        continue;
      }
      for (const u of topUuids(html, 2)) {
        if (found.has(u) || tried.has(u) || !budgetLeft()) continue;
        tried.add(u); // claim before await so concurrent workers don't double-resolve
        fetches++;
        const title = await showTitle(ctx, u);
        if (title) found.set(u, title);
      }
      beat();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const complete = !ctx.signal?.aborted && fetches < maxFetches;
  ctx.log.info("hub enumerated", { shows: found.size, candidates: candidates.size, fetched: fetches, complete });
  return { shows: [...found.entries()].map(([uuid, name]) => ({ uuid, name })), complete };
}
