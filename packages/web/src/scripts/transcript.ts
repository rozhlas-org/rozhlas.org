// Lazy "Přepis" disclosure on the show detail page. The toggle (rendered by
// views.showView when a transcript exists) fetches the transcript on first open
// and renders it as clickable segments — clicking one seeks the player to that
// moment (player.ts handles `.tx-seg`, same as transcript-search `.tx-hit`).

import { api, type ShowTranscriptPart } from "./api.ts";
import { attr, esc, formatDuration } from "./format.ts";

const cache = new Map<string, ShowTranscriptPart[]>();

// Tiny inline glyphs (no icon font) — stroke uses currentColor so they invert.
const LINK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 15l6-6M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1"/></svg>`;
const SHARE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>`;

/** Copy text with a secure-context clipboard API, falling back to execCommand. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Tiny share row (copy-link + native share) — rendered under the transcript toggle
 *  by views.showView so it's always visible without expanding the transcript. */
export function shareRow(slug: string): string {
  const url = `${location.origin}/show/${encodeURIComponent(slug)}`;
  const copy = `<button class="tx-share__btn" type="button" data-share-copy data-url="${attr(url)}" aria-label="Kopírovat odkaz" title="Kopírovat odkaz">${LINK_SVG}<span class="tx-share__lbl">Odkaz</span></button>`;
  // Native share only where the OS sheet exists (mobile) — no dead button on desktop.
  const native =
    typeof navigator !== "undefined" && "share" in navigator
      ? `<button class="tx-share__btn" type="button" data-share-native data-url="${attr(url)}" aria-label="Sdílet" title="Sdílet">${SHARE_SVG}<span class="tx-share__lbl">Sdílet</span></button>`
      : "";
  return `<div class="transcript-share" aria-label="Sdílet">${copy}${native}</div>`;
}

/** Clickable, timestamped segments for one part's transcript text. */
function renderSegments(slug: string, p: ShowTranscriptPart): string {
  const part = p.partIdx == null ? "single" : String(p.partIdx);
  const source = p.segments.length ? p.segments : [{ start: 0, end: 0, text: p.text }];
  const segs = source
    .map((s) => {
      const at = Math.floor(s.start);
      return `<span class="tx-seg" role="button" tabindex="0" data-slug="${attr(slug)}" data-part="${attr(part)}" data-seek="${at}" title="Přehrát od ${esc(formatDuration(at))}">${esc(s.text)} </span>`;
    })
    .join("");
  return `<p class="transcript-text">${segs}</p>`;
}

function renderTranscript(slug: string, parts: ShowTranscriptPart[]): string {
  if (!parts.length) return `<p class="empty">Přepis není k dispozici.</p>`;
  // Single audio (or only one díl transcribed) → just the text, no submenu.
  if (parts.length === 1) {
    return `<div class="transcript-part">${renderSegments(slug, parts[0]!)}</div>`;
  }
  // Multi-part: a díl submenu; only the selected díl's transcript is shown, so the
  // page isn't a single huge wall of every part merged together.
  const label = (p: ShowTranscriptPart) => (p.partIdx == null ? "Díl" : `${p.partIdx}. díl`);
  const nav = parts
    .map(
      (p, i) =>
        `<button class="transcript-nav__item${i === 0 ? " is-active" : ""}" type="button" role="tab" aria-selected="${i === 0}" data-panel="${i}">${esc(label(p))}</button>`,
    )
    .join("");
  const panels = parts
    .map(
      (p, i) =>
        `<div class="transcript-panel" data-panel="${i}"${i === 0 ? "" : " hidden"}>${renderSegments(slug, p)}</div>`,
    )
    .join("");
  return `<div class="transcript-nav" role="tablist" aria-label="Díly přepisu">${nav}</div><div class="transcript-panels">${panels}</div>`;
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

  // Díl submenu: show only the picked part's transcript (multi-part shows).
  document.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".transcript-nav__item");
    if (!item) return;
    const nav = item.closest(".transcript-nav");
    const panels = nav?.parentElement?.querySelector(".transcript-panels");
    const idx = item.dataset.panel;
    if (!nav || !panels || idx == null) return;
    nav.querySelectorAll<HTMLElement>(".transcript-nav__item").forEach((b) => {
      const on = b === item;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
    panels.querySelectorAll<HTMLElement>(".transcript-panel").forEach((p) => {
      p.hidden = p.dataset.panel !== idx;
    });
  });

  // Share row under the transcript: copy-link (with feedback) + native OS share.
  document.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-share-copy],[data-share-native]");
    if (!b) return;
    const url = b.dataset.url ?? location.href;
    if (b.hasAttribute("data-share-native")) {
      try {
        await navigator.share({ title: document.title, url });
      } catch {
        /* user cancelled / unsupported — no-op */
      }
      return;
    }
    if (await copyText(url)) {
      const lbl = b.querySelector<HTMLElement>(".tx-share__lbl");
      const prev = lbl?.textContent ?? "";
      if (lbl) lbl.textContent = "Zkopírováno ✓";
      b.classList.add("is-done");
      setTimeout(() => {
        if (lbl) lbl.textContent = prev;
        b.classList.remove("is-done");
      }, 1500);
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
