import type { ScrapeCtx } from "../types.ts";

// Thin client over the mujRozhlas JSON:API (api.mujrozhlas.cz). A station show's
// episodes are paginated under /shows/<uuid>/episodes (page[limit]/page[offset]).

const API = "https://api.mujrozhlas.cz";
const PAGE = 30;
const ACCEPT = "application/vnd.api+json";
const PER_FETCH_MS = 10_000; // fail a hung fetch fast so the crawl keeps moving

export interface ApiAudioLink {
  url?: string;
  bitrate?: number;
  variant?: string;
}
export interface ApiEpisode {
  id: string; // stable UUID
  attributes: {
    title?: string;
    description?: string;
    since?: string;
    till?: string;
    part?: number | string;
    asset?: { url?: string };
    mirroredSerial?: { title?: string; totalParts?: number };
    audioLinks?: ApiAudioLink[];
  };
  relationships?: { serial?: { data?: { id?: string } | null } };
}

function nextLink(json: any): string | null {
  const n = json?.links?.next;
  return typeof n === "string" ? n : (n?.href ?? null);
}

/**
 * Yield a show's episodes, page by page. Honors ctx.signal (stop promptly),
 * ctx.maxFetches (budget), reports each page via onPage(fetched), and throws on a
 * non-OK response so the caller can record the failure.
 *
 * When `stopBefore` is given, episodes are fetched **newest-first** (`sort=-since`)
 * and iteration stops at the first episode older than the cutoff — so an incremental
 * (nightly) run reads only the recent window instead of paginating the whole history.
 * Episodes with no `since` are always yielded (can't be dated) and don't early-exit.
 */
export async function* iterateEpisodes(
  ctx: ScrapeCtx,
  showUuid: string,
  onPage: () => void,
  stopBefore?: Date,
): AsyncGenerator<ApiEpisode> {
  const sort = stopBefore ? "&sort=-since" : "";
  let url: string | null = `${API}/shows/${showUuid}/episodes?page%5Blimit%5D=${PAGE}${sort}`;
  let fetches = 0;
  const max = ctx.maxFetches ?? Infinity;
  const cutoff = stopBefore?.getTime();
  while (url) {
    if (ctx.signal?.aborted || fetches >= max) return;
    const timeout = AbortSignal.timeout(PER_FETCH_MS);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    const res = await ctx.fetch(url, { headers: { accept: ACCEPT }, signal });
    fetches++;
    onPage();
    if (!res.ok) throw new Error(`mujrozhlas ${res.status} for ${url}`);
    // Hard-time the body read: fetch's AbortSignal doesn't reliably abort a hung
    // res.json() in Bun, which would wedge the whole crawl.
    const json: any = await Promise.race([
      res.json(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("body read timeout")), PER_FETCH_MS)),
    ]);
    for (const ep of (json.data ?? []) as ApiEpisode[]) {
      if (cutoff != null && ep.attributes.since) {
        const t = new Date(ep.attributes.since).getTime();
        // Newest-first → the first too-old episode means all the rest are too. Stop.
        if (Number.isFinite(t) && t < cutoff) return;
      }
      yield ep;
    }
    url = nextLink(json);
  }
}
