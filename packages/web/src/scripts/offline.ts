// Offline downloads: store a show's audio (one Blob per part, keyed by IPFS CID)
// + the show's metadata in IndexedDB. The service worker (sw.js) serves the stored
// bytes for ipfs.rozhlas.org/ipfs/<cid> requests, so saved shows play with no
// network and the player needs no changes. The Stažené page reads the metadata.

import type { ShowDetail } from "./api.ts";

const DB = "rozhlas-offline";
const VERSION = 1;
const AUDIO = "audio"; // key: cid → { blob, size }
const SHOWS = "shows"; // key: slug → SavedShow

export interface SavedPart {
  partIdx: number | string;
  cid: string;
  size: number;
  title: string | null;
  durationSec: number | null;
  streamUrl: string; // gateway URL; the SW serves it from the saved blob offline
}
export interface SavedShow {
  slug: string;
  title: string;
  showName: string | null;
  artworkUrl: string | null;
  source: string;
  durationSec: number | null;
  parts: SavedPart[];
  totalBytes: number;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
      if (!db.objectStoreNames.contains(SHOWS)) db.createObjectStore(SHOWS);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function idbReq<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const tx = db.transaction(store, mode);
        const req = op(tx.objectStore(store));
        req.onsuccess = () => res(req.result as T);
        req.onerror = () => rej(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

const idbGet = <T>(store: string, key: IDBValidKey) => idbReq<T>(store, "readonly", (s) => s.get(key));
const idbPut = (store: string, key: IDBValidKey, val: unknown) =>
  idbReq<void>(store, "readwrite", (s) => s.put(val, key));
const idbDel = (store: string, key: IDBValidKey) => idbReq<void>(store, "readwrite", (s) => s.delete(key));
const idbAll = <T>(store: string) => idbReq<T[]>(store, "readonly", (s) => s.getAll());

/** The streamable parts of a show that we'd download (díly, or the single audio). */
export function showParts(detail: ShowDetail): SavedPart[] {
  const out: SavedPart[] = [];
  if (detail.parts?.length) {
    for (const p of detail.parts) {
      const a = p.audio;
      if (a?.streamable && a.cid && a.streamUrl)
        out.push({ partIdx: p.idx, cid: a.cid, size: a.sizeBytes ?? 0, title: p.title, durationSec: p.durationSec ?? a.durationSec ?? null, streamUrl: a.streamUrl });
    }
  } else {
    const a = detail.audio.find((x) => x.streamable && x.cid && x.streamUrl);
    if (a && a.cid && a.streamUrl)
      out.push({ partIdx: "single", cid: a.cid, size: a.sizeBytes ?? 0, title: detail.title, durationSec: a.durationSec ?? null, streamUrl: a.streamUrl });
  }
  return out;
}

/** Up-front size estimate (sum of known sizeBytes), in bytes. */
export function estimateBytes(detail: ShowDetail): number {
  return showParts(detail).reduce((n, p) => n + (p.size || 0), 0);
}

export async function getSavedShow(slug: string): Promise<SavedShow | null> {
  return (await idbGet<SavedShow | undefined>(SHOWS, slug)) ?? null;
}
export async function isSaved(slug: string): Promise<boolean> {
  return !!(await getSavedShow(slug));
}
export async function listSavedShows(): Promise<SavedShow[]> {
  const all = await idbAll<SavedShow>(SHOWS);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function requestPersist(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}

async function fetchToBlob(url: string, signal: AbortSignal | undefined, onChunk: (n: number) => void): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onChunk(value.byteLength);
  }
  return new Blob(chunks, { type: res.headers.get("content-type") || "audio/mpeg" });
}

/**
 * Download every streamable part of a show and store it. `onProgress(done, total)`
 * fires with cumulative bytes. Throws AbortError on cancel, or on quota exceeded.
 */
export async function saveShow(
  detail: ShowDetail,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  await requestPersist();
  const parts = showParts(detail);
  if (!parts.length) throw new Error("Tento pořad nemá co stáhnout.");
  const total = parts.reduce((n, p) => n + (p.size || 0), 0);
  let done = 0;
  const saved: SavedPart[] = [];
  for (const p of parts) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const blob = await fetchToBlob(p.streamUrl, opts.signal, (n) => {
      done += n;
      opts.onProgress?.(done, total);
    });
    await idbPut(AUDIO, p.cid, { blob, size: blob.size });
    saved.push({ partIdx: p.partIdx, cid: p.cid, size: blob.size, title: p.title, durationSec: p.durationSec, streamUrl: p.streamUrl });
  }
  const meta: SavedShow = {
    slug: detail.slug,
    title: detail.title,
    showName: detail.showName,
    artworkUrl: detail.artworkUrl,
    source: detail.source,
    durationSec: detail.durationSec,
    parts: saved,
    totalBytes: saved.reduce((n, p) => n + p.size, 0),
    savedAt: Date.now(),
  };
  await idbPut(SHOWS, detail.slug, meta);
}

export async function removeShow(slug: string): Promise<void> {
  const s = await getSavedShow(slug);
  if (s) for (const p of s.parts) await idbDel(AUDIO, p.cid);
  await idbDel(SHOWS, slug);
}

/** Rebuild a (partial) ShowDetail from saved metadata so a saved show renders +
 *  plays with no network (the SW serves the audio from IndexedDB). */
export function savedToDetail(s: SavedShow): ShowDetail {
  const audioOf = (p: SavedPart) => ({
    container: null,
    codec: null,
    durationSec: p.durationSec,
    sizeBytes: p.size,
    streamable: true,
    cid: p.cid,
    streamUrl: p.streamUrl,
    hasTranscript: false,
  });
  const single = s.parts.length === 1 && String(s.parts[0]!.partIdx) === "single";
  return {
    slug: s.slug,
    title: s.title,
    description: null,
    showName: s.showName,
    source: s.source,
    publishedAt: null,
    durationSec: s.durationSec,
    artworkUrl: s.artworkUrl,
    plays: 0,
    displays: 0,
    people: [],
    categories: [],
    parts: single ? [] : s.parts.map((p) => ({ idx: Number(p.partIdx), title: p.title, durationSec: p.durationSec, audio: audioOf(p) })),
    audio: single ? [audioOf(s.parts[0]!)] : [],
  };
}

/** Human-readable size, e.g. "482 MB". */
export function fmtBytes(n: number): string {
  if (!n) return "—";
  const mb = n / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(n / 1024))} kB`;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
