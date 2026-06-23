// Persistent bottom player. A single <audio> lives in the app shell (Base.astro),
// OUTSIDE #app, so the SPA router's `app.innerHTML = …` never destroys it —
// playback continues while you click through other pages. Díl rows hand a track
// here via `.part__play` buttons (event-delegated, so re-rendered rows work).
//
// Progress (resume position + "listened") is handled by progress.ts: the shared
// <audio> carries `data-pkey="${slug}#${idx}"`, which its capture-phase listeners
// pick up — no extra wiring needed here.

import { api } from "./api.ts";
import { attr, esc, formatDuration } from "./format.ts";
import { getProgress } from "./progress.ts";
import {
  initPlayerTranscript,
  closeTranscript,
  setTranscriptEnabled,
  transcriptOnTrackChange,
  transcriptOnTime,
} from "./player-transcript.ts";
import {
  clearQueue,
  enqueuePart,
  enqueueParts,
  getQueue,
  onQueueChange,
  queuedPartCount,
  removePart,
  shiftNext,
  takePart,
  type QueueItem,
  type QueuePart,
} from "./queue.ts";
import { logListen } from "./history.ts";

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
  artwork: string | null; // cover thumbnail shown at the left of the bar
  parts: Track[];
  index: number;
}

let q: Queue | null = null;
// Session back-stack of previously-played shows (in-memory; cleared on reload).
// "Previous" at the first díl pops this — the queue is consumed as it advances,
// so it can't provide the show we came from.
const back: Queue[] = [];
function pushBack(): void {
  if (q) {
    back.push(q);
    if (back.length > 50) back.shift();
  }
}

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

/** The show's streamable díly as queue parts (idx + label) — what "add all" enqueues. */
function buildQueueParts(show: Awaited<ReturnType<typeof api.show>>): QueuePart[] {
  if (show.parts.length) {
    return show.parts
      .filter((p) => p.audio?.streamable && p.audio.streamUrl)
      .map((p) => ({ idx: p.idx, title: p.title ?? `${p.idx}. díl` }));
  }
  const a = show.audio.find((x) => x.streamable && x.streamUrl);
  return a ? [{ idx: "single", title: show.title }] : [];
}

// Shell elements (resolved in initPlayer).
let bar: HTMLElement;
let audio: HTMLAudioElement;
let toggleBtn: HTMLButtonElement;
let prevBtn: HTMLButtonElement;
let nextBtn: HTMLButtonElement;
let back15: HTMLButtonElement;
let fwd15: HTMLButtonElement;
let titleLink: HTMLAnchorElement;
let artEl: HTMLElement;
let nowEl: HTMLElement;
let seek: HTMLInputElement;
let timeEl: HTMLElement;
let queueToggle: HTMLButtonElement;
let queueBadge: HTMLElement;
let queuePanel: HTMLElement;
let seeking = false;
let listenLogged = false; // Historie: whether the current track's listen is recorded

function showBar(): void {
  bar.hidden = false;
  document.body.classList.add("has-player");
  syncBarHeight();
}

/** Keep body padding clear of the fixed bar (its height varies: 3 rows, mobile wrap). */
function syncBarHeight(): void {
  if (bar && !bar.hidden) document.documentElement.style.setProperty("--player-h", `${bar.offsetHeight}px`);
}

/** Skip ±15s within the current track (in-track seek, not a track/díl change). */
function skip(delta: number): void {
  if (!q || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  // Clamp below the very end so +15 can't trip `ended` → an accidental advanceQueue.
  audio.currentTime = Math.max(0, Math.min(audio.currentTime + delta, audio.duration - 0.5));
}

const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Put `text` in `el`, and if it overflows the element, loop it as a marquee
 * (slow right-to-left scroll). Seamless: the text is duplicated with a trailing
 * gap and the inner is animated by -50%, so one copy+gap == one period. Static
 * (ellipsis) when it fits or under prefers-reduced-motion.
 */
function setScrollingTitle(el: HTMLElement, text: string): void {
  el.classList.add("marquee");
  el.classList.remove("marquee--on");
  el.style.removeProperty("--marquee-dur");
  el.innerHTML = `<span class="marquee__inner">${esc(text)}</span>`;
  if (reduceMotion || !text) return;
  const inner = el.firstElementChild as HTMLElement;
  requestAnimationFrame(() => {
    if (inner.scrollWidth - el.clientWidth <= 4) return; // fits — leave static
    inner.innerHTML =
      `<span class="marquee__seg">${esc(text)}</span>` +
      `<span class="marquee__seg" aria-hidden="true">${esc(text)}</span>`;
    const period = inner.scrollWidth / 2; // one copy + gap, in px
    el.style.setProperty("--marquee-dur", `${Math.max(6, Math.round(period / 40))}s`); // ~40 px/s
    el.classList.add("marquee--on");
  });
}

function clock(sec: number): string {
  return formatDuration(Math.max(0, Math.floor(sec || 0))) || "0:00";
}

/** Tiny cover-thumbnail markup; a tinted placeholder box when there's no artwork. */
function thumbHtml(url: string | null | undefined, cls: string): string {
  return url
    ? `<span class="${cls}"><img src="${attr(url)}" alt="" loading="lazy" /></span>`
    : `<span class="${cls} ${cls}--empty" aria-hidden="true"></span>`;
}

/** Set the now-playing thumbnail at the left of the bar (placeholder when empty). */
function setBarArt(url: string | null | undefined): void {
  if (!artEl) return;
  artEl.classList.toggle("player-bar__art--empty", !url);
  artEl.innerHTML = url ? `<img src="${attr(url)}" alt="" />` : "";
}

/** Enable transport for the current state: play/next live only if a queue waits. */
function idleControls(): void {
  const hasQueue = getQueue().length > 0;
  toggleBtn.disabled = !hasQueue; // play can still start a waiting queue
  nextBtn.disabled = !hasQueue;
  prevBtn.disabled = true;
  back15.disabled = true; // in-track skip is meaningless with no track loaded
  fwd15.disabled = true;
  seek.disabled = true;
}

/** Nothing loaded: neutral placeholder in the always-visible bar, transport dimmed. */
function setIdle(): void {
  nowEl.textContent = "Přehrávač";
  setScrollingTitle(titleLink, "Nic nehraje");
  titleLink.classList.add("player-bar__title--idle");
  titleLink.removeAttribute("href");
  setBarArt(null);
  toggleBtn.textContent = "▶";
  toggleBtn.setAttribute("aria-label", "Přehrát");
  seek.value = "0";
  timeEl.textContent = "0:00 / 0:00";
  setTranscriptEnabled(false); // nothing playing → no transcript (also closes it)
  idleControls();
}

function pkey(slug: string, idx: string | number): string {
  return `${slug}#${idx}`;
}

/** Build a play queue from a show and start at the given díl id. */
// Set by a deep-link (e.g. a transcript hit) so load() seeks once metadata loads.
let pendingSeek: number | null = null;

export async function playFromSlug(
  slug: string,
  idx: string | number,
  seekSec?: number,
): Promise<boolean> {
  const wantSeek = seekSec != null && Number.isFinite(seekSec) ? seekSec : null;
  // Same track already loaded → seek if asked, else just toggle.
  if (q && q.slug === slug && String(q.parts[q.index]?.idx) === String(idx)) {
    if (wantSeek != null) {
      try {
        audio.currentTime = wantSeek;
      } catch {
        /* not seekable yet */
      }
      audio.play().catch(() => {});
    } else {
      toggle();
    }
    return true;
  }
  const show = await api.show(slug).catch(() => null);
  if (!show) return false;

  const parts = buildParts(show);
  if (!parts.length) return false;

  let start = parts.findIndex((p) => String(p.idx) === String(idx));
  if (start < 0) start = 0;
  pendingSeek = wantSeek;
  if (q && q.slug !== slug) pushBack(); // leaving a different show → remember it
  q = { slug, showTitle: show.title, programme: show.showName, artwork: show.artworkUrl, parts, index: start };
  load(true);
  showBar();
  return true;
}

/**
 * Play a single queued díl: fetch its show, load just that díl as the now-playing
 * track. The rest of the Fronta stays queued and is pulled one díl at a time as this
 * one ends. Returns false if the díl isn't playable. Pushes the outgoing track onto
 * the back-stack so ⏮ can step back through played díly.
 */
async function playQueuePart(item: QueueItem): Promise<boolean> {
  const show = await api.show(item.slug).catch(() => null);
  if (!show) return false;
  const track = buildParts(show).find((t) => String(t.idx) === String(item.idx));
  if (!track) return false;
  pushBack(); // remember whatever we were on so ⏮ can return to it
  q = { slug: item.slug, showTitle: show.title, programme: show.showName, artwork: show.artworkUrl, parts: [track], index: 0 };
  load(true);
  showBar();
  return true;
}

/** Play the next queued díl, skipping any that can't be played. */
async function advanceQueue(): Promise<void> {
  let item = shiftNext();
  while (item) {
    if (await playQueuePart(item)) return;
    item = shiftNext(); // dead/unstreamable díl — skip to the next
  }
  forgetNow(); // queue exhausted — nothing left to restore
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
  q = { slug: saved.slug, showTitle: show.title, programme: show.showName, artwork: show.artworkUrl, parts, index: start };
  load(false); // no autoplay — just show where we left off (bar is always visible)
}

/** Reflect the current track on the OS lock screen / media notification. */
function setMediaMetadata(title: string): void {
  if (!("mediaSession" in navigator) || !q) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: q.programme ?? "Český rozhlas",
      album: q.showTitle,
      artwork: q.artwork ? [{ src: q.artwork, sizes: "400x400", type: "image/webp" }] : [],
    });
  } catch {
    /* MediaMetadata unsupported */
  }
}

/** Wire hardware/lock-screen media keys to the player (once, at startup). */
function initMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(a, h);
    } catch {
      /* this action is unsupported by the browser */
    }
  };
  set("play", () => void audio.play().catch(() => {}));
  set("pause", () => audio.pause());
  set("previoustrack", () => prev());
  set("nexttrack", () => next());
  set("seekbackward", () => skip(-15));
  set("seekforward", () => skip(15));
  set("seekto", (d) => {
    if (d.seekTime != null) {
      try {
        audio.currentTime = d.seekTime;
      } catch {
        /* not seekable yet */
      }
    }
  });
}

function load(autoplay: boolean): void {
  if (!q) return;
  const t = q.parts[q.index]!;
  listenLogged = false; // Historie: log this díl only after it actually plays ~6s
  audio.dataset.pkey = pkey(q.slug, t.idx); // progress.ts keys off this
  audio.src = t.streamUrl;
  audio.load();
  // Deep-link seek (transcript hit): jump to the timestamp once metadata loads,
  // overriding progress.ts's resume seek for this one navigation.
  if (pendingSeek != null) {
    const target = pendingSeek;
    pendingSeek = null;
    audio.addEventListener(
      "loadedmetadata",
      () => {
        try {
          audio.currentTime = target;
        } catch {
          /* not seekable */
        }
      },
      { once: true },
    );
  }
  nowEl.textContent = q.parts.length > 1 ? `Nyní hraje · díl ${q.index + 1}/${q.parts.length}` : "Nyní hraje";
  setBarArt(q.artwork);
  setMediaMetadata(t.title); // OS lock-screen / media controls
  setScrollingTitle(titleLink, t.title);
  titleLink.classList.remove("player-bar__title--idle");
  titleLink.href = `/show/${encodeURIComponent(q.slug)}`;
  toggleBtn.disabled = false;
  seek.disabled = false;
  prevBtn.disabled = false; // prev always at least restarts the díl
  back15.disabled = false;
  fwd15.disabled = false;
  nextBtn.disabled = q.index >= q.parts.length - 1 && getQueue().length === 0; // true dead-end only
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
  if (queuePanelOpen()) renderQueuePanel(); // refresh the "Nyní hraje" row
  setTranscriptEnabled(true); // a track is loaded → the Přepis button is live
  transcriptOnTrackChange(); // refresh the panel for this díl if it's open
}

function toggle(): void {
  if (!q) {
    void advanceQueue(); // nothing loaded but a queue exists → start it
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function prev(): void {
  if (!q) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0; // restart the current díl (standard 3s rule)
    return;
  }
  if (q.index > 0) {
    q.index--; // previous díl within this show
    load(true);
    return;
  }
  const prevShow = back.pop(); // first díl → the previously-played show
  if (prevShow) {
    q = prevShow;
    load(true);
  } else {
    audio.currentTime = 0; // nothing behind → just restart
  }
}

function next(): void {
  if (!q) return;
  if (q.index < q.parts.length - 1) {
    q.index++; // next díl within this show
    load(true);
    return;
  }
  if (getQueue().length) void advanceQueue(); // last díl → next queued show
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

/**
 * Apply the right-to-left marquee to every díl title in the freshly rendered view
 * (detail part list) — same effect as the player bar / Fronta titles. Long titles
 * scroll; short ones stay static. Call once per render (app.ts), on fresh DOM, so
 * the text isn't already wrapped in marquee segments.
 */
export function applyPartMarquees(): void {
  document
    .querySelectorAll<HTMLElement>(".part__title")
    .forEach((el) => setScrollingTitle(el, el.textContent ?? ""));
}

// ---- queue panel ("Fronta") ----

function queuePanelOpen(): boolean {
  return !!queuePanel && !queuePanel.hidden;
}

function renderQueueBadge(): void {
  if (!queueBadge) return;
  const n = queuedPartCount();
  queueBadge.textContent = String(n);
  queueBadge.hidden = n === 0;
}

function bumpBadge(): void {
  if (!queueBadge) return;
  queueBadge.classList.remove("player-bar__badge--bump");
  void queueBadge.offsetWidth; // reflow so the animation restarts
  queueBadge.classList.add("player-bar__badge--bump");
}

/**
 * One queued díl as a flat row (no show grouping): díl number pinned left, show
 * title + díl label, play + remove. Multi-part "add all" therefore lists each díl
 * as its own regular row.
 */
function renderQueueRow(it: QueueItem): string {
  const single = String(it.idx) === "single";
  const idx = single ? "" : `<span class="qrow__idx">${esc(String(it.idx))}.</span>`;
  const sub = single ? it.showName : it.partTitle;
  return (
    `<li class="qrow" data-slug="${attr(it.slug)}" data-idx="${attr(String(it.idx))}">` +
    thumbHtml(it.artworkUrl, "qrow__art") +
    idx +
    `<button class="qrow__play" type="button" title="Přehrát">` +
    `<span class="qrow__title">${esc(it.showTitle)}</span>` +
    (sub ? `<span class="qrow__sub">${esc(sub)}</span>` : "") +
    `</button>` +
    `<span class="qrow__actions">` +
    `<button class="qrow__btn qrow__remove" data-act="remove-part" data-idx="${attr(String(it.idx))}" type="button" aria-label="Odebrat díl z fronty">✕</button>` +
    `</span></li>`
  );
}

function renderQueuePanel(): void {
  if (!queuePanel) return;
  const items = getQueue();
  const nowRow = q
    ? `<div class="queue__section"><div class="queue__label">Nyní hraje</div>` +
      `<div class="qrow qrow--now">` +
      thumbHtml(q.artwork, "qrow__art") +
      `<span class="qrow__text"><span class="qrow__title">${esc(q.showTitle)}</span>` +
      (q.parts.length > 1 ? `<span class="qrow__sub">díl ${q.index + 1}/${q.parts.length}</span>` : "") +
      `</span></div></div>`
    : "";
  const rows = items.map(renderQueueRow).join("");
  const list = items.length
    ? `<div class="queue__section"><div class="queue__label">Další (${queuedPartCount()})</div>` +
      `<ol class="queue__list">${rows}</ol></div>`
    : `<p class="queue__empty">Fronta je prázdná.<br /><span class="queue__hint">Přidejte celý pořad nebo jednotlivý díl tlačítkem ＋.</span></p>`;
  const clear = items.length ? `<button class="queue__clear" type="button">Vymazat frontu</button>` : "";
  const close = `<button class="queue__close" type="button" aria-label="Zavřít frontu" title="Zavřít frontu">✕</button>`;
  queuePanel.innerHTML = `<div class="queue__head"><span class="queue__heading">Fronta</span><span class="queue__headactions">${clear}${close}</span></div>${nowRow}${list}`;
  // Marquee any title that overflows its row.
  queuePanel.querySelectorAll<HTMLElement>(".qrow__title").forEach((el) => setScrollingTitle(el, el.textContent ?? ""));
}

function openQueuePanel(): void {
  queuePanel.hidden = false;
  queueToggle.setAttribute("aria-expanded", "true");
  renderQueuePanel();
  queuePanel.querySelector<HTMLElement>("button")?.focus();
}

function closeQueuePanel(returnFocus = true): void {
  queuePanel.hidden = true;
  queueToggle.setAttribute("aria-expanded", "false");
  if (returnFocus) queueToggle.focus();
}

/** Re-render badge (always) + panel (if open) whenever the queue changes. */
function onQueueChanged(): void {
  renderQueueBadge();
  if (queuePanelOpen()) renderQueuePanel();
  // The queue draining/filling can flip the "next" dead-end state.
  if (q) nextBtn.disabled = q.index >= q.parts.length - 1 && getQueue().length === 0;
  else idleControls(); // no track: play/next live only while a queue is waiting
}

/** Transient feedback on an add-to-queue button (cards re-render, so it self-resets). */
function flashAdd(btn: HTMLButtonElement, mark: string): void {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent ?? "";
  btn.classList.add("queue-add--done");
  btn.textContent = mark;
  setTimeout(() => {
    btn.classList.remove("queue-add--done");
    btn.textContent = btn.dataset.label ?? "＋";
  }, 1300);
}

/** The bar is always visible; just make sure play can start a freshly-added queue. */
function surfaceBarForQueue(): void {
  if (!q) idleControls();
}

/**
 * "Add all díly" — the card only knows the count, so fetch the show once, queue all
 * its streamable díly, and report how many were *newly* added. Keeps the button's
 * label during the fetch (disabled+dimmed), then flashes the result; resets on error.
 */
async function addAllToQueue(
  btn: HTMLButtonElement,
  slug: string,
  meta: { showTitle: string; showName: string | null },
): Promise<void> {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  try {
    const show = await api.show(slug).catch(() => null);
    const parts = show ? buildQueueParts(show) : [];
    if (!parts.length) {
      flashAdd(btn, "⚠"); // nothing streamable to queue (or fetch failed)
      return;
    }
    const added = enqueueParts(
      slug,
      { showTitle: show!.title, showName: show!.showName, artworkUrl: show!.artworkUrl },
      parts,
    );
    flashAdd(btn, added > 0 ? `✓ (+${added})` : "✓"); // +K newly added; ✓ = already queued
    if (added > 0) bumpBadge();
    surfaceBarForQueue();
  } finally {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
  }
}

/** Wire the shell player once at startup. */
export function initPlayer(): void {
  bar = document.getElementById("player")!;
  audio = document.getElementById("player-audio") as HTMLAudioElement;
  toggleBtn = document.getElementById("player-toggle") as HTMLButtonElement;
  prevBtn = document.getElementById("player-prev") as HTMLButtonElement;
  nextBtn = document.getElementById("player-next") as HTMLButtonElement;
  back15 = document.getElementById("player-back15") as HTMLButtonElement;
  fwd15 = document.getElementById("player-fwd15") as HTMLButtonElement;
  titleLink = document.getElementById("player-title") as HTMLAnchorElement;
  artEl = document.getElementById("player-art")!;
  nowEl = document.getElementById("player-now")!;
  seek = document.getElementById("player-seek") as HTMLInputElement;
  timeEl = document.getElementById("player-time")!;
  queueToggle = document.getElementById("player-queue-toggle") as HTMLButtonElement;
  queueBadge = document.getElementById("player-queue-badge")!;
  queuePanel = document.getElementById("player-queue")!;
  if (!bar || !audio) return;

  toggleBtn.addEventListener("click", toggle);
  back15.addEventListener("click", () => skip(-15));
  fwd15.addEventListener("click", () => skip(15));
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);

  // Blue ▶ badge on a card thumbnail → play the show now instead of opening its
  // detail. Capture phase so we preventDefault BEFORE the SPA router's bubble-phase
  // link handler runs (it bails on e.defaultPrevented), so the card <a> never
  // navigates. Enter/Space on the focused badge does the same.
  const playBadge = (badge: HTMLElement) => {
    const slug = badge.dataset.slug;
    // data-idx set (a selection díl card) → play that díl; else "" = first streamable díl.
    if (slug) void playFromSlug(slug, badge.dataset.idx ?? "");
  };
  document.addEventListener(
    "click",
    (e) => {
      const badge = (e.target as HTMLElement).closest<HTMLElement>(".show-card__badge");
      if (!badge) return;
      e.preventDefault();
      e.stopPropagation();
      playBadge(badge);
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const badge = (e.target as HTMLElement).closest<HTMLElement>(".show-card__badge");
    if (!badge) return;
    e.preventDefault();
    playBadge(badge);
  });

  // Delegated: a click anywhere on a playable row (button, title, duration…)
  // plays that díl. Covers re-rendered rows since it's bound to document.
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".queue-add")) return; // the per-díl ＋ enqueues, doesn't play
    const row = target.closest<HTMLElement>(".part--playable");
    if (!row) return;
    e.preventDefault();
    const slug = row.dataset.slug;
    const idx = row.dataset.idx;
    if (slug && idx != null) void playFromSlug(slug, idx);
  });

  // Transcript hit (search result) or segment (detail-page přepis) → play the
  // show's díl at that timestamp.
  document.addEventListener("click", (e) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>(".tx-hit, .tx-seg");
    if (!hit) return;
    e.preventDefault();
    const slug = hit.dataset.slug;
    const part = hit.dataset.part; // "single" or a díl idx
    const seek = Number(hit.dataset.seek);
    if (slug && part != null) void playFromSlug(slug, part, Number.isFinite(seek) ? seek : undefined);
  });

  initMediaSession(); // OS lock-screen / media-key controls

  // ---- live transcript panel ("Přepis") ----
  initPlayerTranscript({
    audio,
    getCurrent: () => (q ? { slug: q.slug, partIdx: q.parts[q.index]!.idx } : null),
    seekTo: (s) => {
      try {
        audio.currentTime = s;
      } catch {
        /* not seekable yet */
      }
    },
    onBeforeOpen: () => closeQueuePanel(false), // transcript + queue are mutually exclusive
  });

  // ---- queue ("Fronta") wiring ----
  // Once open, the panel stays open until the ✕ (or the ☰ toggle) — no auto-close
  // on outside clicks or Escape, so interacting elsewhere can't collapse it.
  queueToggle.addEventListener("click", () => {
    if (queuePanelOpen()) closeQueuePanel();
    else {
      closeTranscript(); // mutually exclusive with the transcript panel
      openQueuePanel();
    }
  });

  // "Add to queue" buttons on cards / detail (inside #app — delegated on document).
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".queue-add");
    if (!btn) return;
    e.preventDefault();
    const slug = btn.dataset.slug;
    if (!slug) return;
    const meta = {
      showTitle: btn.dataset.title ?? slug,
      showName: btn.dataset.showname || null,
      artworkUrl: btn.dataset.artwork || null,
    };
    if (btn.dataset.idx != null) {
      // Single díl — all data is on the button, no fetch.
      const added = enqueuePart(slug, meta, {
        idx: btn.dataset.idx,
        title: btn.dataset.parttitle ?? `${btn.dataset.idx}. díl`,
      });
      flashAdd(btn, added ? "✓" : "•"); // ✓ only when newly added; • = already queued
      if (added) bumpBadge();
      surfaceBarForQueue();
    } else {
      // "Add all" — fetch the show and queue every streamable díl.
      void addAllToQueue(btn, slug, meta);
    }
  });

  // Panel actions (play-now / reorder / remove / clear) — delegated on the panel.
  queuePanel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".queue__close")) {
      closeQueuePanel();
      return;
    }
    const clearBtn = t.closest<HTMLButtonElement>(".queue__clear");
    if (clearBtn) {
      if (clearBtn.dataset.confirm === "1") clearQueue();
      else {
        clearBtn.dataset.confirm = "1"; // two-step confirm
        clearBtn.textContent = "Opravdu vymazat?";
      }
      return;
    }
    const row = t.closest<HTMLElement>(".qrow[data-slug]");
    if (!row) return;
    const slug = row.dataset.slug!;
    const idx = row.dataset.idx;
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "remove-part") removePart(slug, idx!);
    else if (t.closest(".qrow__play")) {
      // Play this díl now; every other queued díl stays put.
      const item = takePart(slug, idx!);
      if (item) {
        void playQueuePart(item);
        closeQueuePanel(false);
      }
    }
  });

  onQueueChange(onQueueChanged);
  onQueueChanged(); // initial badge from any persisted queue

  // Re-measure marquees when the available width changes (resize / rotate).
  let resizeT: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    if (resizeT) clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (q) setScrollingTitle(titleLink, q.parts[q.index]!.title);
      if (queuePanelOpen()) renderQueuePanel();
      syncBarHeight(); // bar height changes when controls wrap on narrow widths
    }, 200);
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
    transcriptOnTime(audio.currentTime); // highlight + follow the speaking line
    if ("mediaSession" in navigator && audio.duration && Number.isFinite(audio.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          position: Math.min(audio.currentTime, audio.duration),
          playbackRate: audio.playbackRate || 1,
        });
      } catch {
        /* setPositionState unsupported */
      }
    }
    // Historie: count a listen once the track has actually played ~6s (skips
    // scrubs/skips; restored-but-not-played tracks never reach this).
    if (q && !listenLogged && audio.currentTime > 6) {
      listenLogged = true;
      const t = q.parts[q.index]!;
      logListen({ slug: q.slug, title: q.showTitle, showName: q.programme, idx: t.idx, partTitle: t.title });
    }
  });
  audio.addEventListener("play", () => {
    toggleBtn.textContent = "❚❚";
    toggleBtn.setAttribute("aria-label", "Pozastavit");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    syncNowPlaying();
  });
  audio.addEventListener("pause", () => {
    toggleBtn.textContent = "▶";
    toggleBtn.setAttribute("aria-label", "Přehrát");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
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
        void advanceQueue(); // last díl done → play the next queued show (or stop)
      }
    }
  });

  // The bar is part of the shell and always on screen. Start in the idle state,
  // then restore the last track (if any) over it.
  bar.hidden = false;
  document.body.classList.add("has-player");
  setIdle();
  syncBarHeight(); // measure the (now visible) bar so content clears it
  void restoreNowPlaying(); // reopen the bar where we left off before a reload
}
