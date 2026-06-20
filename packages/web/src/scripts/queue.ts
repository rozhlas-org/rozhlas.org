// User-curated cross-show play queue ("Fronta"): an ordered list of whole shows
// to play after the current one finishes. Persisted in localStorage, independent
// of the per-show parts queue and the now-playing/progress state.
//
// This module is pure data + a change-notifier — the panel UI and playback hook
// live in player.ts (which owns the shell DOM). Rows are addressed by slug, not
// array index, so a full re-render of the panel can't desync handlers.

const NS = "rozhlas:queue:v1";

export interface QueueItem {
  slug: string;
  title: string;
  showName: string | null;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): QueueItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(NS) || "[]") as unknown;
    return Array.isArray(v) ? (v as QueueItem[]) : [];
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

export function inQueue(slug: string): boolean {
  return read().some((i) => i.slug === slug);
}

/** Append a show. No-op if already queued. Returns true if it was added. */
export function enqueue(item: QueueItem): boolean {
  const items = read();
  if (items.some((i) => i.slug === item.slug)) return false;
  items.push({ slug: item.slug, title: item.title, showName: item.showName });
  write(items);
  return true;
}

export function removeSlug(slug: string): void {
  const items = read();
  const next = items.filter((i) => i.slug !== slug);
  if (next.length !== items.length) write(next);
}

/** Swap the item with `slug` toward the head (-1) or tail (+1). */
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

/** Remove and return the head (the next show to play), or undefined if empty. */
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
