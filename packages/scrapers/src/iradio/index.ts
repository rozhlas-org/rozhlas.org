import type { Scraper, ScrapeCtx, ScrapedShow } from "../types.ts";
import { parsePodcastFeed } from "./rss.ts";

const FEED_URL = (id: string) =>
  `https://api.rozhlas.cz/data/v2/podcast/show/${id}.rss`;

/**
 * Seed podcast feeds (rozhlas v2 API) for the `iradio` source. Each feed is a
 * programme; its RSS items are individual episodes (our `shows`). Discovered
 * during recon — extend this list, or override via discover-job `options.feeds`.
 */
const SEED_FEEDS = [
  "8109468", // Vybrali jsme pro vás
  "6482988",
  "9211552",
  "6504158",
];

/**
 * `iradio` strategy — pulls rozhlas podcast feeds via the official v2 API.
 * Episodes carry full metadata + a direct mp3 enclosure, so `discover` returns
 * fully-scraped shows (no separate detail fetch needed).
 */
export const iradioScraper: Scraper = {
  key: "iradio",
  title: "Český rozhlas iRadio (podcasts)",
  schedule: "0 */6 * * *", // every 6 hours

  async discover(ctx: ScrapeCtx): Promise<ScrapedShow[]> {
    const feeds = (ctx.options?.feeds as string[] | undefined) ?? SEED_FEEDS;
    const perFeedLimit = ctx.limit ?? 50;
    const all: ScrapedShow[] = [];

    for (const feed of feeds) {
      const url = FEED_URL(feed);
      try {
        const res = await ctx.fetch(url);
        if (!res.ok) {
          ctx.log.warn("feed fetch failed", { feed, status: res.status });
          continue;
        }
        const xml = await res.text();
        const episodes = parsePodcastFeed(xml).slice(0, perFeedLimit);
        ctx.log.info("parsed feed", { feed, episodes: episodes.length });
        all.push(...episodes);
        ctx.onProgress?.({ found: all.length, fetched: feeds.indexOf(feed) + 1 });
      } catch (err) {
        ctx.log.error("feed error", { feed, err: String(err) });
      }
    }
    return all;
  },
};
