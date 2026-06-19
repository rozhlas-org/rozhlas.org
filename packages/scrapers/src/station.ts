import type { Scraper, ScrapeCtx, ScrapedShow } from "./types.ts";
import { metaContent } from "./html.ts";
import { parseReadingPage, cleanTitle } from "./cetba/reading.ts";

const BROWSER_UA =
  "Mozilla/5.0 (compatible; rozhlas-org-bot/0.1; +https://github.com/rozhlas-org/rozhlas.org)";

// Non-content slugs to skip while crawling a station site.
const NAV =
  /^\/(o-stanici|o-nas|kontakt|kontakty|program|audioarchiv|kamery|playlisty|lide|dokumenty|hudba|video|page|tag|kategorie|moderator|porady|podcast)\b/;

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

  async function get(ctx: ScrapeCtx, url: string): Promise<string> {
    const res = await ctx.fetch(url, { headers: { "user-agent": BROWSER_UA } });
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
      const limit = ctx.limit ?? 20; // max books per run
      const maxDepth = cfg.maxDepth ?? 2;
      const visited = new Set<string>();
      const seenIds = new Set<string>();
      const out: ScrapedShow[] = [];
      const queue: { url: string; programme?: string; depth: number }[] = seeds.map((u) => ({
        url: abs(u),
        depth: 0,
      }));

      while (queue.length && out.length < limit) {
        const { url, programme, depth } = queue.shift()!;
        if (visited.has(url)) continue;
        visited.add(url);

        let html: string;
        try {
          html = await get(ctx, url);
        } catch (err) {
          ctx.log.warn("fetch failed", { url, err: String(err) });
          continue;
        }

        const reading = parseReadingPage(html, url, programme);
        if (reading?.parts?.length) {
          if (!seenIds.has(reading.sourceId)) {
            seenIds.add(reading.sourceId);
            out.push(reading);
            ctx.log.info("reading", { title: reading.title.slice(0, 50), parts: reading.parts.length });
          }
          continue;
        }

        // Listing/programme page → enqueue child links (up to maxDepth hops).
        if (depth >= maxDepth) continue;
        const childProgramme = cleanTitle(metaContent(html, "og:title")) ?? programme;
        for (const link of candidateLinks(html).slice(0, 40)) {
          const a = abs(link);
          if (!visited.has(a)) queue.push({ url: a, programme: childProgramme, depth: depth + 1 });
        }
      }
      return out.slice(0, limit);
    },
  };
}
