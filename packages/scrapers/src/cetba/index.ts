import type { Scraper, ScrapeCtx, ScrapedShow } from "../types.ts";
import { metaContent } from "../html.ts";
import { parseReadingPage, cleanTitle } from "./reading.ts";

const ORIGIN = "https://vltava.rozhlas.cz";
const BROWSER_UA =
  "Mozilla/5.0 (compatible; rozhlas-org-bot/0.1; +https://github.com/rozhlas-org/rozhlas.org)";

/** Station literary hubs to crawl. The crawler recurses into programme pages. */
const SEEDS = ["/hry-a-cetba"];

const NAV =
  /^\/(o-stanici|o-nas|kontakt|program|audioarchiv|kamery|playlisty|lide|dokumenty|hudba|video|page|tag|kategorie|moderator|porady|podcast)\b/;

function abs(url: string): string {
  return url.startsWith("http") ? url : ORIGIN + url;
}

async function get(ctx: ScrapeCtx, url: string): Promise<string> {
  const res = await ctx.fetch(url, { headers: { "user-agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Same-origin `/slug-<id>` content links (programme pages or readings), de-noised. */
function candidateLinks(html: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/href="((?:https:\/\/vltava\.rozhlas\.cz)?\/[a-z0-9-]+-\d{5,})/g)) {
    const path = m[1]!.replace(ORIGIN, "");
    if (!NAV.test(path)) set.add(path);
  }
  return [...set];
}

/**
 * `cetba` strategy — crawls station literary hubs → programme pages → reading
 * pages, parsing each reading into a multi-part ScrapedShow (DASH audio per díl).
 */
export const cetbaScraper: Scraper = {
  key: "cetba",
  title: "Český rozhlas — četba a literatura",
  schedule: "0 4 * * *", // nightly

  async discover(ctx: ScrapeCtx): Promise<ScrapedShow[]> {
    const seeds = (ctx.options?.seeds as string[] | undefined) ?? SEEDS;
    const limit = ctx.limit ?? 20; // max books per run
    const visited = new Set<string>();
    const seenIds = new Set<string>();
    const out: ScrapedShow[] = [];
    const queue: { url: string; programme?: string }[] = seeds.map((u) => ({ url: abs(u) }));

    while (queue.length && out.length < limit) {
      const { url, programme } = queue.shift()!;
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

      // Listing/programme page → enqueue its child links, tagged with this page's title.
      const childProgramme = cleanTitle(metaContent(html, "og:title")) ?? programme;
      for (const link of candidateLinks(html).slice(0, 40)) {
        const a = abs(link);
        if (!visited.has(a)) queue.push({ url: a, programme: childProgramme });
      }
    }
    return out.slice(0, limit);
  },
};
