// Typed client for the rozhlas.org JSON API. Mirrors the shapes returned by
// packages/api (queries.ts / omnisearch.ts). All calls are client-side.

const API_BASE = (import.meta.env.PUBLIC_API_BASE ?? "https://api.rozhlas.org").replace(/\/$/, "");

export type SortKey = "added" | "plays" | "alpha";

export interface ShowListItem {
  slug: string;
  title: string;
  showName: string | null;
  source: string;
  publishedAt: string | null;
  durationSec: number | null;
  artworkUrl: string | null;
  streamable: boolean;
  /** Count of parts (díly) with streamable audio; 0 for single-audio shows. */
  streamablePartCount: number;
  streamUrl: string | null;
  plays: number;
  displays: number;
  /** Highlighted description snippet (universal search keyword matches; safe HTML). */
  snippet?: string;
  /** Universal search: a timestamped spoken-content match (deep-links into playback). */
  transcriptHit?: { startSec: number; partIdx: number | null; snippet: string };
  /** Selection item that is a specific díl (not the whole show): play/queue that díl. */
  partIdx?: number | null;
  partTitle?: string | null;
}

export interface Selection {
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  itemCount: number;
}
export interface SelectionDetail {
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  items: ShowListItem[];
}

export interface CategoryGroup {
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  showCount: number;
}
export interface CategoryGroupDetail extends ListResult {
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  programmes: string[];
}

export interface ListResult {
  items: ShowListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** A recommended show card ("Co k poslechu"): the show card + editorial note + curation time. */
export interface RecommendationItem extends ShowListItem {
  recId: number;
  description: string | null;
  createdAt: string;
}
export interface RecommendationResult {
  items: RecommendationItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AudioFile {
  container: string | null;
  codec: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
  streamable: boolean;
  cid: string | null;
  streamUrl: string | null;
  hasTranscript: boolean;
}

export interface ShowTranscriptPart {
  partIdx: number | null;
  lang: string | null;
  text: string;
  segments: { start: number; end: number; text: string }[];
}

export interface ShowPart {
  idx: number;
  title: string | null;
  durationSec: number | null;
  audio: AudioFile | null;
}

export interface ShowDetail {
  slug: string;
  title: string;
  description: string | null;
  showName: string | null;
  source: string;
  publishedAt: string | null;
  durationSec: number | null;
  artworkUrl: string | null;
  plays: number;
  displays: number;
  people: { name: string; role: string | null }[];
  categories: { key: string; title: string }[];
  // Serialized shows (četba) have parts (one audio per díl); podcasts use `audio`.
  parts: ShowPart[];
  audio: AudioFile[];
}

export interface Programme {
  programme: string | null;
  count: number;
}

export interface Intent {
  searchText: string;
  themes: string[];
  provider: string;
}

export interface OmniResult {
  intent: Intent;
  items: ShowListItem[];
  total: number; // diversified result count across all pages
  hasMore: boolean; // another page exists after this offset
  vectorHits: number;
  ftsHits: number;
}

export interface TranscriptHit {
  startSec: number;
  endSec: number;
  snippet: string;
  partIdx: number | null; // which díl (null = single-audio show)
}
export interface TranscriptSearchResult {
  items: { show: ShowListItem; hits: TranscriptHit[] }[];
  vectorHits: number;
  ftsHits: number;
}

async function getJSON<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(API_BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Fire-and-forget stat beacon (POST). Never throws — analytics must not break UX. */
function beacon(path: string): void {
  try {
    fetch(API_BASE + path, { method: "POST", keepalive: true }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export const api = {
  shows: (p: { q?: string; programme?: string; source?: string; sort?: SortKey; page?: number }) =>
    getJSON<ListResult>("/api/shows", p),
  show: (slug: string) => getJSON<ShowDetail>(`/api/shows/${encodeURIComponent(slug)}`),
  showTranscript: (slug: string) =>
    getJSON<{ parts: ShowTranscriptPart[] }>(`/api/shows/${encodeURIComponent(slug)}/transcript`),
  similar: (slug: string) => getJSON<ShowListItem[]>(`/api/shows/${encodeURIComponent(slug)}/similar`),
  omnisearch: (q: string, offset = 0) =>
    getJSON<OmniResult>("/api/omnisearch", offset ? { q, offset } : { q }),
  transcriptSearch: (q: string, programme?: string) =>
    getJSON<TranscriptSearchResult>("/api/transcript-search", { q, programme }),
  programmes: () => getJSON<Programme[]>("/api/programmes"),
  selections: () => getJSON<Selection[]>("/api/selections"),
  selection: (slug: string) => getJSON<SelectionDetail>(`/api/selections/${encodeURIComponent(slug)}`),
  categoryGroups: () => getJSON<CategoryGroup[]>("/api/category-groups"),
  categoryGroup: (slug: string, page?: number) =>
    getJSON<CategoryGroupDetail>(`/api/category-groups/${encodeURIComponent(slug)}`, { page }),
  recommendations: (p: { limit?: number; page?: number }) =>
    getJSON<RecommendationResult>("/api/recommendations", p),
  recordPlay: (slug: string) => beacon(`/api/shows/${encodeURIComponent(slug)}/play`),
  recordDisplay: (slug: string) => beacon(`/api/shows/${encodeURIComponent(slug)}/display`),
};
