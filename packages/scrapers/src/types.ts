import type { Logger } from "@rozhlas/core";

/** How a show's audio is reached (PLAN §5). */
export interface MediaSource {
  /** `file` = a direct download (mp3); `dash`/`hls` = a streaming manifest (m4s). */
  kind: "file" | "dash" | "hls";
  url: string;
  /** Optional headers a CDN may require (referer/cookies). */
  headers?: Record<string, string>;
}

export interface ScrapedPerson {
  name: string;
  role?: string;
}

/** One part (díl) of a serialized show, with its own audio. */
export interface ScrapedPart {
  idx: number;
  title?: string;
  durationSec?: number;
  publishedAt?: Date; // this díl's air date, when the source page exposes one
  media: MediaSource;
}

/** A fully-scraped show/episode: metadata + how to fetch its audio. */
export interface ScrapedShow {
  /** Stable id within the source (e.g. RSS guid or reading-page id). */
  sourceId: string;
  title: string;
  description?: string;
  /** Series / programme name. */
  showName?: string;
  publishedAt?: Date;
  durationSec?: number;
  language?: string;
  people?: ScrapedPerson[];
  categories?: string[];
  tags?: string[];
  artworkUrl?: string;
  /** Single-audio shows (podcasts) set `media`; serialized shows set `parts`. */
  media?: MediaSource;
  parts?: ScrapedPart[];
  /** Original payload, persisted to `shows.rawJson` for later re-derivation. */
  raw?: unknown;
}

/** A lightweight pointer used by detail-page sources (discover → fetchShow). */
export interface ShowRef {
  sourceId: string;
  url?: string;
}

/** Per-run context handed to a strategy. */
export interface ScrapeCtx {
  /** fetch wrapper with a polite User-Agent + timeout. */
  fetch: typeof fetch;
  log: Logger;
  /** Cap items per source on a run (keeps runs bounded). */
  limit?: number;
  /** Source-specific options (e.g. podcast feed ids). */
  options?: Record<string, unknown>;
  /** Heartbeat during a crawl — wired to job.updateProgress for queue visibility. */
  onProgress?: (info: { found: number; fetched: number }) => void;
  /** Abort the crawl (watchdog/job timeout). The crawler stops and returns partial. */
  signal?: AbortSignal;
  /** Hard cap on HTTP fetches per run, so runtime stays bounded. */
  maxFetches?: number;
  /** Incremental cutoff: only items published at/after this. API sources fetch
   *  newest-first and stop once older — so a scheduled run touches just the recent
   *  window, not the whole back-catalogue. Undefined = full crawl (first run / backfill). */
  since?: Date;
  /** Persistent cache of a hub source's resolved show UUIDs (worker-provided, bound to
   *  the source). Lets the expensive hub crawl run once and be reused every run. */
  hubCache?: {
    get(): Promise<{ uuid: string; name: string }[]>;
    save(shows: { uuid: string; name: string }[]): Promise<void>;
  };
  /** Operator-triggered: re-enumerate the hub this run (otherwise the cache is reused). */
  refreshHub?: boolean;
}

/**
 * A scrape strategy for one source/page-key. RSS-style sources implement
 * `discover` to return fully-scraped shows directly; detail-page sources return
 * refs from `discover` and resolve them in `fetchShow`.
 */
export interface Scraper {
  key: string;
  title?: string;
  /** cron expression for the repeatable discover job. */
  schedule?: string;
  /** Auto-transcribe this source's audio? Default true; false skips transcription. */
  transcribe?: boolean;
  discover(ctx: ScrapeCtx): Promise<ScrapedShow[]>;
  fetchShow?(ref: ShowRef, ctx: ScrapeCtx): Promise<ScrapedShow>;
}
