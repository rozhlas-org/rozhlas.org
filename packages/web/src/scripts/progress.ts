// Per-díl playback progress, persisted in localStorage so it survives reloads
// and SPA navigation. Two things are remembered per part, keyed by
// `${slug}#${idx}`:
//   • the resume position (seconds) while a part is in progress, and
//   • a "listened" flag once a part has played to the end.
// Audio media events (loadedmetadata/timeupdate/pause/ended) don't bubble, so we
// listen in the capture phase on document — that also covers <audio> elements the
// router renders after this runs, without re-wiring on every navigation.

const NS = "rozhlas:progress:v1";
const SAVE_EVERY_MS = 5000;
const DONE_LEAD_SEC = 60; // count a part "listened" this many seconds before the end
const PKEY = "pkey"; // dataset key → data-pkey attribute

export interface PartProgress {
  t: number; // last position in seconds (0 once finished)
  done: boolean; // listened to the end
  at?: number; // epoch ms of the last save — picks the most-recently-played part (legacy entries: 0)
}

type Store = Record<string, PartProgress>;

function readAll(): Store {
  try {
    return JSON.parse(localStorage.getItem(NS) || "{}") as Store;
  } catch {
    return {};
  }
}

function writeAll(s: Store): void {
  try {
    localStorage.setItem(NS, JSON.stringify(s));
  } catch {
    /* private mode / quota exceeded — progress is best-effort */
  }
}

export function getProgress(key: string): PartProgress | undefined {
  return readAll()[key];
}

/** True if any of a show's parts has saved progress (drives the "Pokračovat" affordance). */
export function showHasProgress(slug: string, parts: { idx: string | number }[]): boolean {
  const s = readAll();
  return parts.some((p) => s[`${slug}#${p.idx}`] != null);
}

/**
 * Pick the start index into an ordered (streamable) parts list for a smart "resume the
 * show" play: the most-recently-played part if it's unfinished; if that part is finished,
 * the first not-yet-finished part; if nothing's been played or everything's finished, the
 * first part. Position within the chosen part is restored separately (loadedmetadata resume).
 */
export function resumeStartIndex(slug: string, parts: { idx: string | number }[]): number {
  const s = readAll();
  // most-recently-saved part with progress (legacy entries: at=0; strict > keeps earliest on ties)
  let bestPos = -1;
  let bestAt = -Infinity;
  for (let i = 0; i < parts.length; i++) {
    const p = s[`${slug}#${parts[i]!.idx}`];
    if (!p) continue;
    const a = p.at ?? 0;
    if (bestPos < 0 || a > bestAt) {
      bestPos = i;
      bestAt = a;
    }
  }
  if (bestPos < 0) return 0; // never played → first part
  if (!s[`${slug}#${parts[bestPos]!.idx}`]!.done) return bestPos; // resume where they were
  // last-played part finished → first not-done part (ordered); all done → restart at 0
  for (let i = 0; i < parts.length; i++) {
    if (!s[`${slug}#${parts[i]!.idx}`]?.done) return i;
  }
  return 0;
}

function save(key: string, p: PartProgress): void {
  const s = readAll();
  s[key] = p;
  writeAll(s);
}

const lastSave = new WeakMap<HTMLAudioElement, number>();

function tracked(t: EventTarget | null): t is HTMLAudioElement {
  return t instanceof HTMLAudioElement && t.dataset[PKEY] != null;
}

function markDone(a: HTMLAudioElement): void {
  save(a.dataset[PKEY]!, { t: 0, done: true, at: Date.now() });
  const li = a.closest(".part");
  if (li) {
    li.classList.add("part--played");
    li.querySelector(".part__resume")?.remove();
  }
}

/** Install the capture-phase listeners. Call once at startup. */
export function wireAudioProgress(): void {
  // Resume: seek to the saved position as soon as metadata is available.
  document.addEventListener(
    "loadedmetadata",
    (e) => {
      const a = e.target;
      if (!tracked(a)) return;
      const p = getProgress(a.dataset[PKEY]!);
      if (p && !p.done && p.t > 1 && a.currentTime < 1) {
        const dur = a.duration || p.t;
        try {
          a.currentTime = Math.min(p.t, dur - 1);
        } catch {
          /* not seekable yet — leave at 0 */
        }
      }
    },
    true,
  );

  // Persist position periodically while playing.
  document.addEventListener(
    "timeupdate",
    (e) => {
      const a = e.target;
      if (!tracked(a)) return;
      const now = Date.now();
      if (now - (lastSave.get(a) ?? 0) < SAVE_EVERY_MS) return;
      lastSave.set(a, now);
      if (getProgress(a.dataset[PKEY]!)?.done) return;
      // Count it listened once within ~1 min of the end — the listener needn't reach
      // the very last second. For short parts fall back to ~90% so a brief clip isn't
      // marked done almost at the start.
      if (a.duration > 0 && a.currentTime >= Math.max(a.duration - DONE_LEAD_SEC, a.duration * 0.9)) {
        markDone(a);
        return;
      }
      if (a.currentTime > 1) save(a.dataset[PKEY]!, { t: a.currentTime, done: false, at: now });
    },
    true,
  );

  // Persist immediately on pause (covers navigating away mid-part).
  document.addEventListener(
    "pause",
    (e) => {
      const a = e.target;
      if (!tracked(a)) return;
      if (getProgress(a.dataset[PKEY]!)?.done) return;
      const nearEnd = a.duration > 0 && a.currentTime >= a.duration - 1;
      if (a.currentTime > 1 && !nearEnd) save(a.dataset[PKEY]!, { t: a.currentTime, done: false, at: Date.now() });
    },
    true,
  );

  // Mark a part listened once it finishes.
  document.addEventListener(
    "ended",
    (e) => {
      if (tracked(e.target)) markDone(e.target);
    },
    true,
  );
}
