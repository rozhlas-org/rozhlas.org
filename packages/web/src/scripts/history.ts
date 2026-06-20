// Local view/listen history ("Historie"). An append-only log in localStorage,
// rendered on the /historie page. Sibling of progress.ts / queue.ts: pure data,
// best-effort, :v1 namespace (the only "migration"), no cross-tab sync, and no
// change-notifier — it's a destination page, re-read fresh on navigation.

const NS = "rozhlas:history:v1";
const CAP = 1000;
const COALESCE_MS = 30 * 60 * 1000; // skip a repeat of the same item within 30 min

export type HistoryType = "view" | "listen";

export interface HistoryEntry {
  type: HistoryType;
  slug: string;
  title: string;
  showName: string | null;
  idx?: string | number; // listens: which díl
  partTitle?: string;
  at: number; // epoch ms
}

function read(): HistoryEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(NS) || "[]") as unknown;
    return Array.isArray(v) ? (v as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(items: HistoryEntry[]): void {
  try {
    localStorage.setItem(NS, JSON.stringify(items));
  } catch {
    /* private mode / quota exceeded — history is best-effort */
  }
}

function sameItem(a: HistoryEntry, type: HistoryType, slug: string, idx?: string | number): boolean {
  return a.type === type && a.slug === slug && String(a.idx ?? "") === String(idx ?? "");
}

function commit(items: HistoryEntry[], entry: HistoryEntry): void {
  // Coalesce: skip a repeat of the same item within the window (kills back/forward
  // re-view spam and accidental same-díl replays); distant repeats still record.
  const head = items[0];
  if (head && sameItem(head, entry.type, entry.slug, entry.idx) && entry.at - head.at < COALESCE_MS) {
    write(items); // a superseded view above may still need persisting
    return;
  }
  items.unshift(entry);
  if (items.length > CAP) items.length = CAP;
  write(items);
}

export function logView(show: { slug: string; title: string; showName: string | null }): void {
  commit(read(), { type: "view", slug: show.slug, title: show.title, showName: show.showName, at: Date.now() });
}

export function logListen(t: {
  slug: string;
  title: string;
  showName: string | null;
  idx: string | number;
  partTitle: string;
}): void {
  const items = read();
  // A listen supersedes a just-logged "view" of the same show (open-then-play).
  if (items[0]?.type === "view" && items[0].slug === t.slug) items.shift();
  commit(items, {
    type: "listen",
    slug: t.slug,
    title: t.title,
    showName: t.showName,
    idx: t.idx,
    partTitle: t.partTitle,
    at: Date.now(),
  });
}

export function getHistory(): HistoryEntry[] {
  return read();
}

export function clearHistory(): void {
  write([]);
}
