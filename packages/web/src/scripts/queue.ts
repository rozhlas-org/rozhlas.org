// User-curated cross-show play queue ("Fronta"): a FLAT, ordered list of díly to
// play. Each entry is a single díl (a show slug + a díl idx); "add all" pushes one
// entry per streamable díl. The panel shows every queued díl as its own row, and
// playing one consumes just that díl — the rest stay queued.
//
// Persisted in localStorage, independent of the now-playing/progress state. Entries
// are addressed by slug+idx so a full panel re-render can't desync handlers.

// v3: flat per-díl shape ({slug, idx, partTitle, showTitle, showName}). Older
// queues (v1 show-level, v2 grouped) are ignored — the queue is best-effort.
const NS = "rozhlas:queue:v3";

export interface QueuePart {
  idx: string | number; // díl id; "single" for one-audio shows
  title: string;
}
export interface QueueItem {
  slug: string;
  idx: string | number;
  partTitle: string;
  showTitle: string;
  showName: string | null;
  artworkUrl?: string | null; // tiny cover thumbnail; optional (older entries lack it)
}
export interface ShowMeta {
  showTitle: string;
  showName: string | null;
  artworkUrl?: string | null;
}

type Listener = () => void;
const listeners = new Set<Listener>();

const keyOf = (slug: string, idx: string | number): string => `${slug}#${idx}`;

function read(): QueueItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(NS) || "[]") as unknown;
    if (!Array.isArray(v)) return [];
    return (v as QueueItem[]).filter(
      (it) => it && typeof it.slug === "string" && it.idx != null,
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

export function getQueue(): QueueItem[] {
  return read();
}

/** Number of queued díly — the badge count. */
export function queuedPartCount(): number {
  return read().length;
}

export function inQueuePart(slug: string, idx: string | number): boolean {
  return read().some((i) => i.slug === slug && String(i.idx) === String(idx));
}

/**
 * Append `parts` (in the given order) as flat díl entries, skipping any already
 * queued (by slug+idx). Returns how many were *newly* added (0 ⇒ all already there).
 */
export function enqueueParts(slug: string, meta: ShowMeta, parts: QueuePart[]): number {
  if (!parts.length) return 0;
  const items = read();
  const have = new Set(items.map((i) => keyOf(i.slug, i.idx)));
  let added = 0;
  for (const p of parts) {
    const k = keyOf(slug, p.idx);
    if (have.has(k)) continue;
    items.push({
      slug,
      idx: p.idx,
      partTitle: p.title,
      showTitle: meta.showTitle,
      showName: meta.showName,
      artworkUrl: meta.artworkUrl ?? null,
    });
    have.add(k);
    added++;
  }
  if (added === 0) return 0;
  write(items);
  return added;
}

/** Add a single díl. Returns true if it was newly added. */
export function enqueuePart(slug: string, meta: ShowMeta, part: QueuePart): boolean {
  return enqueueParts(slug, meta, [part]) > 0;
}

/** Drop one díl. */
export function removePart(slug: string, idx: string | number): void {
  const items = read();
  const next = items.filter((i) => !(i.slug === slug && String(i.idx) === String(idx)));
  if (next.length !== items.length) write(next);
}

/**
 * "Play this díl now": remove ONLY the clicked díl (it becomes now-playing) and keep
 * every other queued díl in place. Returns the clicked díl, or undefined if missing.
 */
export function takePart(slug: string, idx: string | number): QueueItem | undefined {
  const items = read();
  const k = items.findIndex((i) => i.slug === slug && String(i.idx) === String(idx));
  if (k < 0) return undefined;
  const [item] = items.splice(k, 1);
  write(items);
  return item;
}

export function clearQueue(): void {
  write([]);
}

/** Remove and return the head díl (the next to play), or undefined if empty. */
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
