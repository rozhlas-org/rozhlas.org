// User-curated cross-show play queue ("Fronta"). Each entry is a SHOW carrying the
// set of its díly (parts) the user queued — so "add all" and "add one díl" both land
// in the same place, the panel can show every queued part, and playback fetches a
// show once and plays just its queued parts (gapless within the show).
//
// Persisted in localStorage, independent of the now-playing/progress state. Entries
// are addressed by slug, parts within an entry by idx — a full panel re-render can't
// desync handlers.

// v2: shape changed from show-level {slug,title,showName} to part-aware. Old v1
// queues are ignored (the queue is best-effort/ephemeral), not migrated.
const NS = "rozhlas:queue:v2";

export interface QueuePart {
  idx: string | number; // díl id; "single" for one-audio shows
  title: string;
}
export interface QueueItem {
  slug: string;
  showTitle: string;
  showName: string | null;
  parts: QueuePart[]; // queued díly, kept in idx order
}
export interface ShowMeta {
  showTitle: string;
  showName: string | null;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): QueueItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(NS) || "[]") as unknown;
    if (!Array.isArray(v)) return [];
    // Tolerate partial/legacy rows: keep only well-formed entries with parts.
    return (v as QueueItem[]).filter(
      (it) => it && typeof it.slug === "string" && Array.isArray(it.parts) && it.parts.length > 0,
    );
  } catch {
    return [];
  }
}

function write(items: QueueItem[]): void {
  try {
    localStorage.setItem(NS, JSON.stringify(items));
  } catch {
    /* private mode / quota exceeded — the queue is best-effort */
  }
  listeners.forEach((fn) => fn());
}

/** Numeric-aware part ordering; "single" and non-numeric sort to the end, stably. */
function partRank(idx: string | number): number {
  const n = typeof idx === "number" ? idx : Number(idx);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}
function sortParts(parts: QueuePart[]): QueuePart[] {
  return parts.slice().sort((a, b) => partRank(a.idx) - partRank(b.idx));
}

export function getQueue(): QueueItem[] {
  return read();
}

/** Total queued díly across all shows — the badge count. */
export function queuedPartCount(): number {
  return read().reduce((n, it) => n + it.parts.length, 0);
}

export function inQueuePart(slug: string, idx: string | number): boolean {
  const it = read().find((x) => x.slug === slug);
  return !!it && it.parts.some((p) => String(p.idx) === String(idx));
}

/**
 * Merge `parts` into `slug`'s entry (creating it if absent), deduped by idx and kept
 * in díl order. Returns how many parts were *newly* added (0 ⇒ all already queued).
 */
export function enqueueParts(slug: string, meta: ShowMeta, parts: QueuePart[]): number {
  if (!parts.length) return 0;
  const items = read();
  let entry = items.find((x) => x.slug === slug);
  if (!entry) {
    entry = { slug, showTitle: meta.showTitle, showName: meta.showName, parts: [] };
    items.push(entry);
  }
  const have = new Set(entry.parts.map((p) => String(p.idx)));
  let added = 0;
  for (const p of parts) {
    if (have.has(String(p.idx))) continue;
    entry.parts.push({ idx: p.idx, title: p.title });
    have.add(String(p.idx));
    added++;
  }
  if (added === 0) return 0;
  entry.parts = sortParts(entry.parts);
  write(items);
  return added;
}

/** Add a single díl. Returns true if it was newly added. */
export function enqueuePart(slug: string, meta: ShowMeta, part: QueuePart): boolean {
  return enqueueParts(slug, meta, [part]) > 0;
}

/** Drop one díl; if its show then has no queued parts, drop the show entry. */
export function removePart(slug: string, idx: string | number): void {
  const items = read();
  const entry = items.find((x) => x.slug === slug);
  if (!entry) return;
  const next = entry.parts.filter((p) => String(p.idx) !== String(idx));
  if (next.length === entry.parts.length) return;
  entry.parts = next;
  write(next.length ? items : items.filter((x) => x.slug !== slug));
}

/** Drop a whole show entry. */
export function removeShow(slug: string): void {
  const items = read();
  const next = items.filter((x) => x.slug !== slug);
  if (next.length !== items.length) write(next);
}

/** Swap the show entry with `slug` toward the head (-1) or tail (+1). */
export function move(slug: string, dir: -1 | 1): void {
  const items = read();
  const i = items.findIndex((x) => x.slug === slug);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j]!, items[i]!];
  write(items);
}

export function clearQueue(): void {
  write([]);
}

/** Remove and return the head show entry (the next to play), or undefined if empty. */
export function shiftNext(): QueueItem | undefined {
  const items = read();
  const head = items.shift();
  if (head) write(items);
  return head;
}

/** Subscribe to queue changes (badge + panel re-render). */
export function onQueueChange(fn: Listener): void {
  listeners.add(fn);
}
