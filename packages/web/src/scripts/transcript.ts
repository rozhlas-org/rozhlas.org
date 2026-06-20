// Lazy "Přepis" disclosure on the show detail page. The toggle (rendered by
// views.showView when a transcript exists) fetches the transcript on first open
// and renders it as clickable segments — clicking one seeks the player to that
// moment (player.ts handles `.tx-seg`, same as transcript-search `.tx-hit`).

import { api, type ShowTranscriptPart } from "./api.ts";
import { attr, esc, formatDuration } from "./format.ts";

const cache = new Map<string, ShowTranscriptPart[]>();

function renderTranscript(slug: string, parts: ShowTranscriptPart[]): string {
  if (!parts.length) return `<p class="empty">Přepis není k dispozici.</p>`;
  return parts
    .map((p) => {
      const part = p.partIdx == null ? "single" : String(p.partIdx);
      const heading =
        p.partIdx == null ? "" : `<h4 class="transcript-part__dil">${esc(String(p.partIdx))}. díl</h4>`;
      const source = p.segments.length ? p.segments : [{ start: 0, end: 0, text: p.text }];
      const segs = source
        .map((s) => {
          const at = Math.floor(s.start);
          return `<span class="tx-seg" role="button" tabindex="0" data-slug="${attr(slug)}" data-part="${attr(part)}" data-seek="${at}" title="Přehrát od ${esc(formatDuration(at))}">${esc(s.text)} </span>`;
        })
        .join("");
      return `<div class="transcript-part">${heading}<p class="transcript-text">${segs}</p></div>`;
    })
    .join("");
}

/** Install the delegated handlers once at startup. */
export function wireTranscript(): void {
  document.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".transcript-toggle");
    if (!btn) return;
    const body = btn.closest(".transcript")?.querySelector<HTMLElement>(".transcript-body");
    const slug = btn.dataset.slug;
    if (!body || !slug) return;

    // Already rendered → just toggle visibility.
    if (body.dataset.loaded) {
      const open = !body.hidden;
      body.hidden = open;
      btn.setAttribute("aria-expanded", String(!open));
      btn.textContent = open ? "Zobrazit přepis" : "Skrýt přepis";
      return;
    }

    btn.textContent = "Načítám…";
    btn.disabled = true;
    try {
      let parts = cache.get(slug);
      if (!parts) {
        parts = (await api.showTranscript(slug)).parts;
        cache.set(slug, parts);
      }
      body.innerHTML = renderTranscript(slug, parts);
      body.dataset.loaded = "1";
      body.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "Skrýt přepis";
    } catch {
      body.innerHTML = `<p class="notice">Přepis se nepodařilo načíst.</p>`;
      body.hidden = false;
      btn.textContent = "Zobrazit přepis";
    } finally {
      btn.disabled = false;
    }
  });

  // Keyboard: Enter/Space on a focused segment seeks (it's role="button").
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const seg = (e.target as HTMLElement).closest<HTMLElement>(".tx-seg");
    if (seg) {
      e.preventDefault();
      seg.click();
    }
  });
}
