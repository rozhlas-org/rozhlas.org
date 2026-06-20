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
 * Yield every episode of a show, page by page. Honors ctx.signal (stop promptly),
 * ctx.maxFetches (budget), and reports each page via onPage(fetched). Throws on a
 * non-OK response so the caller can record the failure.
 */
export async function* iterateEpisodes(
  ctx: ScrapeCtx,
  showUuid: string,
  onPage: () => void,
): AsyncGenerator<ApiEpisode> {
  let url: string | null = `${API}/shows/${showUuid}/episodes?page%5Blimit%5D=${PAGE}`;
  let fetches = 0;
  const max = ctx.maxFetches ?? Infinity;
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
    for (const ep of (json.data ?? []) as ApiEpisode[]) yield ep;
    url = nextLink(json);
  }
}
