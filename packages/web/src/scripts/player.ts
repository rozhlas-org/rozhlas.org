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

interface Track {
  idx: string | number;
  title: string;
  streamUrl: string;
}
interface Queue {
  slug: string;
  showTitle: string;
  programme: string | null;
  parts: Track[];
  index: number;
}

let q: Queue | null = null;

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

  let parts: Track[];
  if (show.parts.length) {
    parts = show.parts
      .filter((p) => p.audio?.streamable && p.audio.streamUrl)
      .map((p) => ({ idx: p.idx, title: p.title ?? `${p.idx}. díl`, streamUrl: p.audio!.streamUrl! }));
  } else {
    const a = show.audio.find((x) => x.streamable && x.streamUrl);
    parts = a ? [{ idx: "single", title: show.title, streamUrl: a.streamUrl! }] : [];
  }
  if (!parts.length) return;

  let start = parts.findIndex((p) => String(p.idx) === String(idx));
  if (start < 0) start = 0;
  q = { slug, showTitle: show.title, programme: show.showName, parts, index: start };
  load(true);
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
  seek.value = "0";
  timeEl.textContent = "0:00 / 0:00";
  if (autoplay) {
    audio.play().catch(() => {});
    void api.recordPlay(q.slug); // count a play per track start (knows the slug)
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
  const btn = document.querySelector<HTMLButtonElement>(
    `.part__play[data-slug="${CSS.escape(q.slug)}"][data-idx="${CSS.escape(String(t.idx))}"]`,
  );
  if (btn) {
    btn.closest(".part")?.classList.add("part--playing");
    if (!audio.paused) {
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
    syncNowPlaying();
  });

  // Delegated play buttons in the (re-rendered) page body.
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".part__play");
    if (!btn) return;
    e.preventDefault();
    const slug = btn.dataset.slug;
    const idx = btn.dataset.idx;
    if (slug && idx != null) void playFromSlug(slug, idx);
  });

  // Seek bar (0..1000 fraction of duration).
  seek.addEventListener("input", () => {
    seeking = true;
    if (audio.duration) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  });
  seek.addEventListener("change", () => {
    seeking = false;
  });

  audio.addEventListener("timeupdate", () => {
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
        .querySelector(`.part__play[data-slug="${CSS.escape(q.slug)}"][data-idx="${CSS.escape(String(t.idx))}"]`)
        ?.closest(".part")
        ?.classList.add("part--played");
      if (q.index < q.parts.length - 1) {
        q.index++;
        load(true);
      }
    }
  });
}
