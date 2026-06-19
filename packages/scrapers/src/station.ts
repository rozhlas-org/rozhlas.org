import type { Scraper, ScrapeCtx, ScrapedShow } from "./types.ts";
import { metaContent } from "./html.ts";
import { parseReadingPage, cleanTitle } from "./cetba/reading.ts";

const BROWSER_UA =
  "Mozilla/5.0 (compatible; rozhlas-org-bot/0.1; +https://github.com/rozhlas-org/rozhlas.org)";

// Non-content slugs to skip while crawling a station site.
const NAV =
  /^\/(o-stanici|o-nas|kontakt|kontakty|program|audioarchiv|kamery|playlisty|lide|dokumenty|hudba|video|page|tag|kategorie|moderator|porady|podcast)\b/;

// Listing pages paginate via ?page=N. Safety cap on how far to page a listing.
const MAX_LISTING_PAGES = 80;
// Default polite gap between requests (PLAN §10). Per-source override via cfg.delayMs;
// throttling stations (Dvojka) need a bigger gap.
const REQUEST_DELAY_MS = Number(process.env.SCRAPE_DELAY_MS ?? 200);
// Hard cap on HTTP fetches per run so runtime stays bounded (a listing crawl
// fetches far more pages than it finds readings).
const DEFAULT_MAX_FETCHES = 2500;
// Per-request hard timeout — a single hung fetch must never freeze the crawl.
const PER_FETCH_MS = 25_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Return `url` with its `page` query param set to `n`. */
function withPage(url: string, n: number): string {
  const u = new URL(url);
  u.searchParams.set("page", String(n));
  return u.toString();
}

export interface StationConfig {
  key: string;
  title: string;
  schedule?: string;
  /** Station origin, e.g. "https://wave.rozhlas.cz". */
  origin: string;
  /** Hub/programme paths to start crawling from, e.g. ["/audioknihy-radia-wave-9166009"]. */
  seeds: string[];
  /**
   * How many link-hops past the seed to follow. 1 = only readings linked directly
   * from a hub (curated lists like Wave audiobooks). 2 = hub → programme pages →
   * readings (Vltava, where the hub links sub-programme listings). Default 2.
   */
  maxDepth?: number;
  /** Per-request delay (ms). Raise for throttling stations (Dvojka). */
  delayMs?: number;
}

/**
 * A scraper for a Czech Radio station site (mujRozhlas-based). Crawls hub →
 * programme → reading pages and parses each reading into a multi-part ScrapedShow
 * (DASH audio per díl). Shared by every station source (cetba, wave-audiobooks, …).
 */
export function makeStationScraper(cfg: StationConfig): Scraper {
  const abs = (url: string) => (url.startsWith("http") ? url : cfg.origin + url);
  const hostRe = cfg.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkRe = new RegExp(`href="((?:${hostRe})?\\/[a-z0-9-]+-\\d{5,})`, "g");

  // Retry on rate-limit / transient errors with exponential backoff, so a 403/429
  // (the station throttling a bigger crawl) doesn't abort a listing's pagination.
  async function get(ctx: ScrapeCtx, url: string, attempt = 0): Promise<string> {
    // Combine the crawl-wide abort with a per-request timeout so neither a hung
    // body read nor a stalled connection can wedge the crawl.
    const timeout = AbortSignal.timeout(PER_FETCH_MS);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    const res = await ctx.fetch(url, { headers: { "user-agent": BROWSER_UA }, signal });
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1500 * 2 ** attempt); // 1.5s, 3s, 6s
      return get(ctx, url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  /** Same-origin `/slug-<id>` content links (programme pages or readings), de-noised. */
  function candidateLinks(html: string): string[] {
    const set = new Set<string>();
    for (const m of html.matchAll(linkRe)) {
      const path = m[1]!.replace(cfg.origin, "");
      if (!NAV.test(path)) set.add(path);
    }
    return [...set];
  }

  return {
    key: cfg.key,
    title: cfg.title,
    schedule: cfg.schedule,

    async discover(ctx: ScrapeCtx): Promise<ScrapedShow[]> {
      const seeds = (ctx.options?.seeds as string[] | undefined) ?? cfg.seeds;
      // Default high enough to drain a full archive (hundreds of episodes across
      // paginated listings); already-pinned items short-circuit on re-runs.
      const limit = ctx.limit ?? 1000;
      const maxDepth = cfg.maxDepth ?? 2;
      const maxFetches = ctx.maxFetches ?? DEFAULT_MAX_FETCHES;
      const delayMs = cfg.delayMs ?? REQUEST_DELAY_MS;
      const visited = new Set<string>();
      const seenIds = new Set<string>();
      const out: ScrapedShow[] = [];
      const queue: { url: string; programme?: string; depth: number; page: number }[] = seeds.map(
        (u) => ({ url: abs(u), depth: 0, page: 1 }),
      );

      let fetches = 0;
      let stopReason = "drained";
      while (queue.length && out.length < limit) {
        // Bounded + interruptible: stop on watchdog abort or the fetch budget so a
        // run always ends (returning whatever was found so far).
        if (ctx.signal?.aborted) { stopReason = "aborted"; break; }
        if (fetches >= maxFetches) { stopReason = "fetch-budget"; break; }

        const { url, programme, depth, page } = queue.shift()!;
        if (visited.has(url)) continue;
        visited.add(url);

        // Be a polite crawler: small gap between requests (PLAN §10).
        if (fetches++ > 0) await sleep(delayMs);

        let html: string;
        try {
          html = await get(ctx, url);
        } catch (err) {
          if (ctx.signal?.aborted) { stopReason = "aborted"; break; }
          ctx.log.warn("fetch failed", { url, err: String(err) });
          continue;
        }

        const reading = parseReadingPage(html, url, programme);
        if (reading?.parts?.length) {
          if (!seenIds.has(reading.sourceId)) {
            seenIds.add(reading.sourceId);
            out.push(reading);
            ctx.log.info("reading", { title: reading.title.slice(0, 50), parts: reading.parts.length });
            ctx.onProgress?.({ found: out.length, fetched: fetches });
          }
          continue;
        }

        // Listing/programme page → enqueue child links (up to maxDepth hops).
        if (depth >= maxDepth) continue;
        const childProgramme = cleanTitle(metaContent(html, "og:title")) ?? programme;
        const links = candidateLinks(html).slice(0, 60);
        for (const link of links) {
          const a = abs(link);
          if (!visited.has(a)) queue.push({ url: a, programme: childProgramme, depth: depth + 1, page: 1 });
        }
        // Paginate the listing itself (?page=N) — same depth, not a deeper hop.
        // Self-terminating: a page with no content links enqueues no further page.
        if (links.length > 0 && page < MAX_LISTING_PAGES) {
          const next = withPage(url, page + 1);
          if (!visited.has(next)) {
            queue.push({ url: next, programme: childProgramme, depth, page: page + 1 });
          }
        }
      }
      ctx.log.info("crawl done", { found: out.length, fetched: fetches, stop: stopReason });
      return out.slice(0, limit);
    },
  };
}
