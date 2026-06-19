// Typed client for the rozhlas.org JSON API. Mirrors the shapes returned by
// packages/api (queries.ts / omnisearch.ts). All calls are client-side.

const API_BASE = (import.meta.env.PUBLIC_API_BASE ?? "https://api.rozhlas.org").replace(/\/$/, "");

export interface ShowListItem {
  slug: string;
  title: string;
  showName: string | null;
  source: string;
  publishedAt: string | null;
  durationSec: number | null;
  artworkUrl: string | null;
  streamable: boolean;
  streamUrl: string | null;
}

export interface ListResult {
  items: ShowListItem[];
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
  people: { name: string; role: string | null }[];
  categories: { key: string; title: string }[];
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

export const api = {
  shows: (p: { q?: string; programme?: string; source?: string; page?: number }) =>
    getJSON<ListResult>("/api/shows", p),
  show: (slug: string) => getJSON<ShowDetail>(`/api/shows/${encodeURIComponent(slug)}`),
  search: (q: string, page?: number) =>
    getJSON<{ query: string } & ListResult>("/api/search", { q, page }),
  omnisearch: (q: string) => getJSON<OmniResult>("/api/omnisearch", { q }),
  programmes: () => getJSON<Programme[]>("/api/programmes"),
};
