// Live transcript panel inside the player. Pops above the bar (like the queue),
// shows the CURRENT díl's transcript, highlights the speaking sentence and follows
// playback — pausing if the user scrolls (a pill re-engages; it also auto-resumes
// after a few idle seconds). Click a line to seek. Mutually exclusive with the
// queue panel (the toggle wiring + onBeforeOpen live in player.ts).

import { api, type ShowTranscriptPart } from "./api.ts";
import { esc } from "./format.ts";

interface Deps {
  audio: HTMLAudioElement;
  /** The currently-loaded track, or null when idle. */
  getCurrent: () => { slug: string; partIdx: string | number } | null;
  seekTo: (sec: number) => void;
  /** Close the queue panel — the two panels are mutually exclusive. */
  onBeforeOpen: () => void;
}

let d: Deps;
let toggleBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;
let followPill: HTMLButtonElement | null = null;

const cache = new Map<string, ShowTranscriptPart[]>();
let segEls: HTMLElement[] = [];
let segStarts: number[] = [];
let activeIdx = -1;
let renderToken = 0;
let autoFollow = true;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;

const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function initPlayerTranscript(deps: Deps): void {
  d = deps;
  toggleBtn = document.getElementById("player-transcript-toggle") as HTMLButtonElement | null;
  panel = document.getElementById("player-transcript");
  if (!toggleBtn || !panel) return;

  toggleBtn.addEventListener("click", () => {
    if (isTranscriptOpen()) closeTranscript(true);
    else void openTranscript();
  });

  // Delegated panel clicks: close · re-engage follow · seek to a line.
  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".transcript-pop__close")) return closeTranscript(true);
    if (t.closest(".transcript-pop__follow")) return engageFollow();
    const seg = t.closest<HTMLElement>(".ptx-seg");
    if (seg && seg.dataset.start != null) {
      d.seekTo(Number(seg.dataset.start));
      engageFollow();
    }
  });
}

export function isTranscriptOpen(): boolean {
  return !!panel && !panel.hidden;
}

/** Enable/disable the toggle (a track is/ isn't loaded); disabling also closes it. */
export function setTranscriptEnabled(on: boolean): void {
  if (toggleBtn) toggleBtn.disabled = !on;
  if (!on) closeTranscript(false);
}

export function closeTranscript(returnFocus = false): void {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  toggleBtn?.setAttribute("aria-expanded", "false");
  if (resumeTimer) clearTimeout(resumeTimer);
  if (returnFocus) toggleBtn?.focus();
}

export async function openTranscript(): Promise<void> {
  if (!panel) return;
  d.onBeforeOpen(); // close the queue (mutual exclusivity)
  panel.hidden = false;
  toggleBtn?.setAttribute("aria-expanded", "true");
  await renderCurrent();
}

/** Re-render for the now-current part if open (called from player load()). */
export function transcriptOnTrackChange(): void {
  if (isTranscriptOpen()) void renderCurrent();
}

/** Highlight + follow the speaking sentence (called from timeupdate). */
export function transcriptOnTime(t: number): void {
  if (!isTranscriptOpen() || !segStarts.length) return;
  let i = activeIdx < 0 ? 0 : activeIdx;
  while (i + 1 < segStarts.length && segStarts[i + 1]! <= t) i++;
  while (i > 0 && segStarts[i]! > t) i--;
  if (i === activeIdx) return;
  segEls[activeIdx]?.classList.remove("ptx-seg--on");
  activeIdx = i;
  segEls[i]?.classList.add("ptx-seg--on");
  if (autoFollow) scrollToActive();
}

function scrollToActive(): void {
  segEls[activeIdx]?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
}

function engageFollow(): void {
  autoFollow = true;
  if (followPill) followPill.hidden = true;
  if (resumeTimer) clearTimeout(resumeTimer);
  scrollToActive();
}

// User scrolled the transcript → stop following; show the pill; auto-resume idle.
function pauseFollow(): void {
  autoFollow = false;
  if (followPill) followPill.hidden = false;
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(engageFollow, 8000);
}

function label(partIdx: string | number): string {
  return String(partIdx) === "single" ? "Přepis" : `Přepis · ${partIdx}. díl`;
}

function pickPart(parts: ShowTranscriptPart[], partIdx: string | number): ShowTranscriptPart | undefined {
  if (String(partIdx) === "single") return parts.find((p) => p.partIdx == null) ?? parts[0];
  return parts.find((p) => String(p.partIdx) === String(partIdx));
}

function shell(title: string, inner: string): string {
  return (
    `<div class="transcript-pop__head"><span class="transcript-pop__title">${esc(title)}</span>` +
    `<button class="transcript-pop__close" type="button" aria-label="Zavřít přepis" title="Zavřít přepis">✕</button></div>` +
    `<div class="transcript-pop__body">${inner}</div>` +
    `<button class="transcript-pop__follow" type="button" hidden>↓ Skok na aktuální</button>`
  );
}

/** Re-resolve element refs after an innerHTML swap and wire user-scroll detection. */
function paint(html: string): void {
  if (!panel) return;
  panel.innerHTML = html;
  bodyEl = panel.querySelector(".transcript-pop__body");
  followPill = panel.querySelector(".transcript-pop__follow");
  if (bodyEl) {
    bodyEl.addEventListener("wheel", pauseFollow, { passive: true });
    bodyEl.addEventListener("touchmove", pauseFollow, { passive: true });
  }
}

async function renderCurrent(): Promise<void> {
  segEls = [];
  segStarts = [];
  activeIdx = -1;
  autoFollow = true;
  if (resumeTimer) clearTimeout(resumeTimer);

  const cur = d.getCurrent();
  if (!cur) {
    paint(shell("Přepis", `<p class="transcript-pop__empty">Nic nehraje.</p>`));
    return;
  }
  const mine = ++renderToken;
  paint(shell(label(cur.partIdx), `<p class="transcript-pop__empty">Načítám…</p>`));
  try {
    let parts = cache.get(cur.slug);
    if (!parts) {
      parts = (await api.showTranscript(cur.slug)).parts;
      cache.set(cur.slug, parts);
    }
    if (mine !== renderToken) return; // a track change superseded this render
    const part = pickPart(parts, cur.partIdx);
    if (!part || !(part.segments.length || part.text.trim())) {
      paint(shell(label(cur.partIdx), `<p class="transcript-pop__empty">Přepis tohoto dílu zatím není k dispozici.</p>`));
      return;
    }
    const segs = part.segments.length ? part.segments : [{ start: 0, end: 0, text: part.text }];
    const spans = segs
      .map((s) => `<span class="ptx-seg" data-start="${Math.max(0, Math.floor(s.start))}">${esc(s.text)} </span>`)
      .join("");
    paint(shell(label(cur.partIdx), `<p class="transcript-pop__text">${spans}</p>`));
    segEls = [...panel!.querySelectorAll<HTMLElement>(".ptx-seg")];
    segStarts = segEls.map((el) => Number(el.dataset.start));
    transcriptOnTime(d.audio.currentTime); // highlight from where playback is now
  } catch {
    if (mine !== renderToken) return;
    paint(shell(label(cur.partIdx), `<p class="transcript-pop__empty">Přepis se nepodařilo načíst.</p>`));
  }
}
