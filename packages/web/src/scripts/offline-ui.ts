// Detail-page "Uložit offline" control: download a show's audio to the device with
// a progress bar, cancel, and remove. The state lives in IndexedDB (offline.ts);
// the service worker then plays saved shows with no network.

import { api, type ShowDetail } from "./api.ts";
import { locked } from "./auth.ts";
import * as off from "./offline.ts";

const details = new Map<string, ShowDetail>(); // cached detail per slug (for the save action)
const aborters = new Map<string, AbortController>();

function renderIdle(el: HTMLElement, bytes: number): void {
  const size = bytes ? ` <span class="offline-size">(${off.fmtBytes(bytes)})</span>` : "";
  el.innerHTML = `<button class="offline-toggle" type="button" data-act="save">⤓ Uložit offline${size}</button>`;
}
function renderSaved(el: HTMLElement, bytes: number): void {
  el.innerHTML =
    `<span class="offline-badge">✓ Uloženo offline${bytes ? ` · ${off.fmtBytes(bytes)}` : ""}</span> ` +
    `<button class="offline-toggle offline-toggle--ghost" type="button" data-act="remove">Odebrat</button>`;
}
function renderProgress(el: HTMLElement): void {
  el.innerHTML =
    `<div class="offline-progress"><div class="offline-progress__bar" style="width:0%"></div>` +
    `<span class="offline-progress__label">Stahuji… 0 %</span></div>` +
    `<button class="offline-toggle offline-toggle--ghost" type="button" data-act="cancel">Zrušit</button>`;
}

/** Fill the detail page's offline control after the view renders (lazy, like Podobné). */
export async function mountOffline(): Promise<void> {
  if (locked()) return; // gate: offline save is a playback feature
  const el = document.querySelector<HTMLElement>(".offline[data-slug]");
  if (!el || el.dataset.ready) return;
  el.dataset.ready = "1";
  const slug = el.dataset.slug!;
  try {
    if (await off.isSaved(slug)) {
      renderSaved(el, (await off.getSavedShow(slug))?.totalBytes ?? 0);
      return;
    }
    const detail = await api.show(slug);
    details.set(slug, detail);
    if (!off.showParts(detail).length) {
      el.innerHTML = ""; // nothing streamable to save
      return;
    }
    renderIdle(el, off.estimateBytes(detail));
  } catch {
    el.innerHTML = "";
  }
}

async function startSave(el: HTMLElement, slug: string): Promise<void> {
  let detail = details.get(slug);
  if (!detail) {
    try {
      detail = await api.show(slug);
      details.set(slug, detail);
    } catch {
      return;
    }
  }
  const ac = new AbortController();
  aborters.set(slug, ac);
  renderProgress(el);
  const bar = el.querySelector<HTMLElement>(".offline-progress__bar");
  const lbl = el.querySelector<HTMLElement>(".offline-progress__label");
  try {
    await off.saveShow(detail, {
      signal: ac.signal,
      onProgress: (done, total) => {
        const pct = total ? Math.min(99, Math.round((done / total) * 100)) : 0;
        if (bar) bar.style.width = `${pct}%`;
        if (lbl) lbl.textContent = `Stahuji… ${pct} %`;
      },
    });
    aborters.delete(slug);
    renderSaved(el, (await off.getSavedShow(slug))?.totalBytes ?? 0);
  } catch (err) {
    aborters.delete(slug);
    await off.removeShow(slug).catch(() => {}); // clear any partial download
    if ((err as { name?: string })?.name === "AbortError") {
      renderIdle(el, off.estimateBytes(detail));
    } else {
      renderIdle(el, off.estimateBytes(detail));
      const note = document.createElement("span");
      note.className = "offline-err";
      note.textContent = " Stažení selhalo (možná došlo místo).";
      el.appendChild(note);
    }
  }
}

/** Install the delegated click handlers once at startup. Handles the detail-page
 *  control (.offline[data-slug] wrapper) and the Stažené-card remove ✕. */
export function initOffline(): void {
  document.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".offline-toggle");
    if (!btn) return;
    const wrap = btn.closest<HTMLElement>(".offline[data-slug]");
    const slug = wrap?.dataset.slug || btn.dataset.slug;
    if (!slug) return;
    const act = btn.dataset.act;
    if (act === "save" && wrap) {
      void startSave(wrap, slug);
    } else if (act === "cancel") {
      aborters.get(slug)?.abort();
    } else if (act === "remove") {
      await off.removeShow(slug).catch(() => {});
      const card = btn.closest<HTMLElement>(".saved-card");
      if (card) {
        card.remove(); // on the Stažené page the card drops out
      } else if (wrap) {
        const detail = details.get(slug);
        renderIdle(wrap, detail ? off.estimateBytes(detail) : 0);
        if (!detail) void mountOffline();
      }
    }
  });
}
