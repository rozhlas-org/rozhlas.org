// Saved shows ("Oblíbené"): a user-curated set of shows, persisted in localStorage.
// Sibling of queue.ts/history.ts — pure data + a change-notifier. We store a
// card-renderable subset of the show (captured when saved) so the Oblíbené page
// renders full cards with no fetch and no API change (the queue does the same with
// artwork). Best-effort, de-duped by slug, newest-first.

const NS = "rozhlas:favourites:v1";
const CAP = 500; // bound localStorage; refuse new saves past this

// A card-renderable subset of ShowListItem (see views.ts showCard) + when it was saved.
export interface FavItem {
  slug: string;
  title: string;
  showName: string | null;
  source: string;
  publishedAt: string | null;
  durationSec: number | null;
  artworkUrl: string | null;
  streamable: boolean;
  streamablePartCount: number;
  plays: number;
  displays: number;
  addedAt: number; // epoch ms
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): FavItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(NS) || "[]") as unknown;
    if (!Array.isArray(v)) return [];
    // One corrupt/partial entry must not crash the grid render — drop anything
    // missing the two fields showCard hard-requires.
    return (v as FavItem[]).filter((f) => f && typeof f.slug === "string" && typeof f.title === "string");
  } catch {
    return [];
  }
}

/** Persist + notify. Returns false if the write was rejected (quota/private mode). */
function write(items: FavItem[]): boolean {
  let ok = true;
  try {
    localStorage.setItem(NS, JSON.stringify(items));
  } catch {
    ok = false; // private mode / quota — best-effort
  }
  listeners.forEach((fn) => fn());
  return ok;
}

/** Saved shows, newest first. */
export function getFavourites(): FavItem[] {
  return read().sort((a, b) => b.addedAt - a.addedAt);
}

export function isFavourite(slug: string): boolean {
  return read().some((f) => f.slug === slug);
}

/** Save a show. No-op if already saved or the list is full. Returns true if added. */
export function addFavourite(item: Omit<FavItem, "addedAt">): boolean {
  const items = read();
  if (items.some((f) => f.slug === item.slug)) return false;
  if (items.length >= CAP) return false;
  items.push({ ...item, addedAt: Date.now() });
  return write(items);
}

export function removeFavourite(slug: string): void {
  const items = read();
  const next = items.filter((f) => f.slug !== slug);
  if (next.length !== items.length) write(next);
}

/**
 * Toggle a show's saved state. Returns the resulting state (true = now saved).
 * On a failed save (quota) returns false so the caller doesn't show a false "saved".
 */
export function toggleFavourite(item: Omit<FavItem, "addedAt">): boolean {
  if (isFavourite(item.slug)) {
    removeFavourite(item.slug);
    return false;
  }
  return addFavourite(item);
}

/** Refresh the stored card fields for an already-saved show (opportunistic, keeps
 *  artwork/counts fresh on detail load). No-op if not saved. */
export function refreshFavourite(item: Omit<FavItem, "addedAt">): void {
  const items = read();
  const cur = items.find((f) => f.slug === item.slug);
  if (!cur) return;
  Object.assign(cur, item); // keep original addedAt
  write(items);
}

export function clearFavourites(): void {
  write([]);
}

/** Subscribe to changes (nav count + re-render the Oblíbené page if open). */
export function onFavouritesChange(fn: Listener): void {
  listeners.add(fn);
}
