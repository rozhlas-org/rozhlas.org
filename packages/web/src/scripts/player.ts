// Persistent bottom player. A single <audio> lives in the app shell (Base.astro),
// OUTSIDE #app, so the SPA router's `app.innerHTML = …` never destroys it —
// playback continues while you click through other pages. Díl rows hand a track
// here via `.part__play` buttons (event-delegated, so re-rendered rows work).
//
// Progress (resume position + "listened") is handled by progress.ts: the shared
// <audio> carries `data-pkey="${slug}#${idx}"`, which its capture-phase listeners
// pick up — no extra wiring needed here.

import { api } from "./api.ts";
import { formatDuration } from "./format.ts";
import { getProgress } from "./progress.ts";

interface Track {
  idx: string | number;
  title: string;
  streamUrl: string;
  durationSec: number | null;
}
interface Queue {
  slug: string;
  showTitle: string;
  programme: string | null;
  parts: Track[];
  index: number;
}

let q: Queue | null = null;

// Remember what's playing so a reload can re-open the bar at the same track.
const NOW_NS = "rozhlas:nowplaying:v1";

function rememberNow(): void {
  if (!q) return;
  try {
    localStorage.setItem(NOW_NS, JSON.stringify({ slug: q.slug, idx: q.parts[q.index]!.idx }));
  } catch {
    /* best-effort */
  }
}

function forgetNow(): void {
  try {
    localStorage.removeItem(NOW_NS);
  } catch {
    /* best-effort */
  }
}

/** Streamable parts of a show as a play queue, in order. */
function buildParts(show: Awaited<ReturnType<typeof api.show>>): Track[] {
  if (show.parts.length) {
    return show.parts
      .filter((p) => p.audio?.streamable && p.audio.streamUrl)
      .map((p) => ({
        idx: p.idx,
        title: p.title ?? `${p.idx}. díl`,
        streamUrl: p.audio!.streamUrl!,
        durationSec: p.durationSec ?? p.audio!.durationSec ?? null,
      }));
  }
  const a = show.audio.find((x) => x.streamable && x.streamUrl);
  return a ? [{ idx: "single", title: show.title, streamUrl: a.streamUrl!, durationSec: a.durationSec ?? null }] : [];
}

// Shell elements (resolved in initPlayer).
let bar: HTMLElement;
let audio: HTMLAudioElement;
let toggleBtn: HTMLButtonElement;
let prevBtn: HTMLButtonElement;
let nextBtn: HTMLButtonElement;
let titleLink: HTMLAnchorElement;
let nowEl: HTMLElement;
let seek: HTMLInputElement;
let timeEl: HTMLElement;
let seeking = false;

function clock(sec: number): string {
  return formatDuration(Math.max(0, Math.floor(sec || 0))) || "0:00";
}

function pkey(slug: string, idx: string | number): string {
  return `${slug}#${idx}`;
}

/** Build a play queue from a show and start at the given díl id. */
export async function playFromSlug(slug: string, idx: string | number): Promise<void> {
  // Same track already loaded → just toggle.
  if (q && q.slug === slug && String(q.parts[q.index]?.idx) === String(idx)) {
    toggle();
    return;
  }
  const show = await api.show(slug).catch(() => null);
  if (!show) return;

  const parts = buildParts(show);
  if (!parts.length) return;

  let start = parts.findIndex((p) => String(p.idx) === String(idx));
  if (start < 0) start = 0;
  q = { slug, showTitle: show.title, programme: show.showName, parts, index: start };
  load(true);
  bar.hidden = false;
  document.body.classList.add("has-player");
}

/**
 * Reopen the bar on the last-played track after a reload — paused, parked at
 * where the listener left off (progress.ts seeks the <audio> on first play).
 */
async function restoreNowPlaying(): Promise<void> {
  let saved: { slug: string; idx: string | number } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(NOW_NS) || "null");
  } catch {
    saved = null;
  }
  if (!saved?.slug) return;
  const show = await api.show(saved.slug).catch(() => null);
  if (!show) return;
  const parts = buildParts(show);
  if (!parts.length) return;
  let start = parts.findIndex((p) => String(p.idx) === String(saved!.idx));
  if (start < 0) start = 0;
  q = { slug: saved.slug, showTitle: show.title, programme: show.showName, parts, index: start };
  load(false); // no autoplay — just show where we left off
  bar.hidden = false;
  document.body.classList.add("has-player");
}

function load(autoplay: boolean): void {
  if (!q) return;
  const t = q.parts[q.index]!;
  audio.dataset.pkey = pkey(q.slug, t.idx); // progress.ts keys off this
  audio.src = t.streamUrl;
  audio.load();
  nowEl.textContent = q.parts.length > 1 ? `Nyní hraje · díl ${q.index + 1}/${q.parts.length}` : "Nyní hraje";
  titleLink.textContent = t.title;
  titleLink.href = `/show/${encodeURIComponent(q.slug)}`;
  prevBtn.disabled = q.index === 0 && audio.currentTime < 3;
  nextBtn.disabled = q.index >= q.parts.length - 1;
  rememberNow(); // survive a reload
  const dur = t.durationSec ?? 0;
  if (autoplay) {
    seek.value = "0";
    timeEl.textContent = `0:00 / ${clock(dur)}`;
    audio.play().catch(() => {});
    void api.recordPlay(q.slug); // count a play per track start (knows the slug)
  } else {
    // Restored after a reload: reflect the saved resume position right away.
    const saved = getProgress(pkey(q.slug, t.idx));
    const pos = saved && !saved.done ? saved.t : 0;
    seek.value = dur ? String(Math.round((pos / dur) * 1000)) : "0";
    timeEl.textContent = `${clock(pos)} / ${clock(dur)}`;
  }
  syncNowPlaying();
}

function toggle(): void {
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function prev(): void {
  if (!q) return;
  if (audio.currentTime > 3 || q.index === 0) {
    audio.currentTime = 0;
  } else {
    q.index--;
    load(true);
  }
}

function next(): void {
  if (!q || q.index >= q.parts.length - 1) return;
  q.index++;
  load(true);
}

/**
 * Reflect the now-playing track in whatever the router just rendered into #app:
 * highlight the matching díl and flip its play button to a pause glyph. Call after
 * every render and on track change.
 */
export function syncNowPlaying(): void {
  document.querySelectorAll(".part--playing").forEach((el) => el.classList.remove("part--playing"));
  document.querySelectorAll<HTMLButtonElement>(".part__play").forEach((b) => {
    b.textContent = "▶";
    b.setAttribute("aria-label", "Přehrát");
  });
  if (!q) return;
  const t = q.parts[q.index]!;
  const row = document.querySelector(
    `.part--playable[data-slug="${CSS.escape(q.slug)}"][data-idx="${CSS.escape(String(t.idx))}"]`,
  );
  if (row) {
    row.classList.add("part--playing");
    const btn = row.querySelector<HTMLButtonElement>(".part__play");
    if (btn && !audio.paused) {
      btn.textContent = "❚❚";
      btn.setAttribute("aria-label", "Pozastavit");
    }
  }
}

/** Wire the shell player once at startup. */
export function initPlayer(): void {
  bar = document.getElementById("player")!;
  audio = document.getElementById("player-audio") as HTMLAudioElement;
  toggleBtn = document.getElementById("player-toggle") as HTMLButtonElement;
  prevBtn = document.getElementById("player-prev") as HTMLButtonElement;
  nextBtn = document.getElementById("player-next") as HTMLButtonElement;
  titleLink = document.getElementById("player-title") as HTMLAnchorElement;
  nowEl = document.getElementById("player-now")!;
  seek = document.getElementById("player-seek") as HTMLInputElement;
  timeEl = document.getElementById("player-time")!;
  if (!bar || !audio) return;

  toggleBtn.addEventListener("click", toggle);
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  document.getElementById("player-close")?.addEventListener("click", () => {
    audio.pause();
    bar.hidden = true;
    document.body.classList.remove("has-player");
    q = null;
    forgetNow();
    syncNowPlaying();
  });

  // Delegated: a click anywhere on a playable row (button, title, duration…)
  // plays that díl. Covers re-rendered rows since it's bound to document.
  document.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".part--playable");
    if (!row) return;
    e.preventDefault();
    const slug = row.dataset.slug;
    const idx = row.dataset.idx;
    if (slug && idx != null) void playFromSlug(slug, idx);
  });

  // Seek bar (0..1000 fraction of duration). Commit the seek ONCE, on release.
  // A type=range fires `input` continuously while dragging; writing currentTime on
  // every event fires a storm of range-request seeks that can wedge the streamed
  // <audio>. So during the drag we only preview the time, and seek on `change`.
  const seekPos = () => (audio.duration ? (Number(seek.value) / 1000) * audio.duration : 0);
  seek.addEventListener("input", () => {
    seeking = true;
    if (audio.duration) timeEl.textContent = `${clock(seekPos())} / ${clock(audio.duration)}`;
  });
  seek.addEventListener("change", () => {
    if (audio.duration) audio.currentTime = seekPos();
    seeking = false;
  });

  // Stall safeguard: if playback hangs (slow/aborted range request after a seek)
  // with no progress for a while, reload the src and restore the position so the
  // element self-heals — instead of needing a manual track switch to reset it.
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let recovering = false;
  const clearStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = undefined;
  };
  const recover = () => {
    if (recovering || !audio.src) return;
    recovering = true;
    clearStall();
    const pos = audio.currentTime;
    const wasPlaying = !audio.paused;
    const onMeta = () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      try {
        if (pos > 0 && audio.duration) audio.currentTime = Math.min(pos, audio.duration - 0.5);
      } catch {
        /* not seekable yet */
      }
      if (wasPlaying) audio.play().catch(() => {});
      recovering = false;
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.load();
  };
  const armStall = () => {
    if (recovering) return;
    clearStall();
    // Only fire if playback truly makes no progress (timeupdate/playing clear it).
    stallTimer = setTimeout(() => { if (!audio.paused) recover(); }, 12_000);
  };
  audio.addEventListener("waiting", armStall);
  audio.addEventListener("stalled", armStall);
  audio.addEventListener("playing", clearStall);
  audio.addEventListener("pause", clearStall);
  audio.addEventListener("error", recover);

  audio.addEventListener("timeupdate", () => {
    clearStall(); // real progress → not stuck
    if (!seeking && audio.duration) seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    timeEl.textContent = `${clock(audio.currentTime)} / ${clock(audio.duration)}`;
    if (q) prevBtn.disabled = q.index === 0 && audio.currentTime < 3;
  });
  audio.addEventListener("play", () => {
    toggleBtn.textContent = "❚❚";
    toggleBtn.setAttribute("aria-label", "Pozastavit");
    syncNowPlaying();
  });
  audio.addEventListener("pause", () => {
    toggleBtn.textContent = "▶";
    toggleBtn.setAttribute("aria-label", "Přehrát");
    syncNowPlaying();
  });
  // Auto-advance to the next díl; also mark the finished one done in the live DOM.
  audio.addEventListener("ended", () => {
    if (q) {
      const t = q.parts[q.index]!;
      document
        .querySelector(`.part--playable[data-slug="${CSS.escape(q.slug)}"][data-idx="${CSS.escape(String(t.idx))}"]`)
        ?.classList.add("part--played");
      if (q.index < q.parts.length - 1) {
        q.index++;
        load(true);
      } else {
        forgetNow(); // finished the last díl — nothing to restore
      }
    }
  });

  void restoreNowPlaying(); // reopen the bar where we left off before a reload
}
