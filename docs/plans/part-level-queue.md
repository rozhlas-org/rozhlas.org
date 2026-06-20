# Plan: part-level queue (fix "add all", add per-part add)

> Revised after UX review. Switched from a flat part-entry model to a **show entry
> carrying a set of queued parts** (the reviewer's Option B) — it keeps in-show
> playback gapless, avoids duplicate part-vs-show rows, and is less code.

## What the user reports
- "Add all to queue" on a multi-part show "still only adds the first part."
- Wants a small per-part button to add **one** díl to the queue.

## Actual diagnosis (verified, not assumed)
Playback already reaches every part: for a sample multi-part show all streamable
parts carry a `streamUrl` (`streamable` is only set after `ipfs-verify` confirms a
CID), `buildParts` returns all of them, and the `ended` handler auto-advances through
the show. No playback-level "first part only" bug was reproducible.

The real problem is the **show-level queue**: `QueueItem = { slug, title, showName }`,
one row per show. "Add all" pushes **one** row → reads as "only the first part," and
there's no way to **see**, **remove**, or **add a single** díl. The fix is to make the
queue **part-aware**.

## Design — show entry with a set of queued parts (recommended)

### Data model (`queue.ts`)
```ts
interface QueuePart { idx: string | number; title: string } // "single" idx ⇒ one-audio show
interface QueueItem {
  slug: string;
  showTitle: string;
  showName: string | null;
  parts: QueuePart[];   // the queued parts for this show, kept in idx order
}
```
- Identity: a show appears **once**; its `parts[]` is the queued subset.
- `enqueueParts(slug, meta, parts[])` — merge parts into the show's entry (create it if
  absent), dedup by `idx`, keep sorted by `idx`. Returns count of **newly added** parts.
- `enqueuePart(slug, meta, part)` — single-part convenience (per-part ＋).
- `removePart(slug, idx)` — drop one part; if the entry's `parts` becomes empty, drop
  the entry. `removeShow(slug)`, `move(slug, dir)` (whole-show reorder), `getQueue`,
  `clearQueue`, `shiftNext` operate on **show entries**.

Why this over flat part entries: same-show parts stay together in one entry, so
playback fetches the show **once** and advances through its queued parts with **no gap**
(a flat model would re-`api.show` per part → audible silence mid-show — UX-review M2).
It also removes the "play-now duplicates part rows" ambiguity (M5).

### Enqueue sources
1. **Card "Vše do fronty (N)"** — the card only knows `streamablePartCount`, so on click
   fetch `api.show(slug)` once, take its streamable parts, `enqueueParts(...)`. Button
   states (UX-review M3):
   - idle `＋ Vše do fronty (N)` → pending: **disabled + dimmed**, `aria-busy`, label kept
     (no width-jitter on the cramped over-artwork pill) → success: flash `✓ (+K)` where
     **K = newly added** (not N), bump badge by K → already all queued: `✓` no bump →
     **fetch error: reset to idle**, brief `⚠`.
2. **Detail "Přidat do fronty (N dílů)"** — detail has `show.parts` already → synchronous
   `enqueueParts(...)`, no fetch.
3. **NEW per-part ＋** on each detail part row — enqueues just that díl (`enqueuePart`).

### Detail part row affordance (UX-review M1, N2)
Two clearly distinct intents, reusing the existing visual language:
- **▶ `.part__play`** (cyan, solid) — unchanged: play **from this díl through the rest of
  the show** (`playFromSlug(slug, idx)`; player shows "díl k/N" and auto-advances). Do
  **not** change to "play only this part".
- **NEW ＋** — paper/outline `.queue-add` style (so it never reads as a second play
  control). `aria-label="Přidat tento díl do fronty"`, `title="Přidat díl do fronty"`.
  Placed **trailing** (right side; leading is occupied by the absolute ▶ and the row's
  `padding-left:66px`). Offset so it doesn't collide with `.part__check` ✓ on played rows.
  Visual ~34px (matches `.queue-add`) but full row-height (44px) hit area.
  Dedup feedback (N4): flash `✓` + badge bump **only when newly added**; if already
  queued, neutral mark, no bump (wire to `enqueuePart`'s returned boolean).

### Playback (`player.ts`)
- **Immediate play** (click díl row, card ▶, "play now") — unchanged: load the show, play
  through its parts via `buildParts`.
- **Fronta advance** (`advanceQueue`): take the next **show entry**, fetch `api.show(slug)`
  **once**, build tracks for **only that entry's queued `parts`** (in order), play them
  gaplessly; when the entry is exhausted, advance to the next entry. (One fetch per
  **show**, not per part — M2.)
- **Play-now on a Fronta show** plays that show's queued parts and **removes the whole
  entry** from the Fronta (no leftover part rows fighting the player — M5).

### Panel (`renderQueuePanel`) — UX-review M4
- One block per **show entry**: a sub-heading (`showTitle` + `díly 1–N` / `N dílů` via the
  existing `dilWord()` helper) with its queued part rows beneath. **Collapse** groups
  larger than ~4 parts behind "Zobrazit díly".
- **Reorder at the show level** (▲/▼ move whole entry). **Per-part action = remove (✕)
  only** — drop per-part ▲/▼ (plumbing nobody asked for; creates cross-group ambiguity).
- Part rows reuse `.qrow__title` so long titles inherit the existing marquee (N3).
- Single-audio shows: one row labeled with the **show title**, **no díl numbering** (N1).

## Out of scope
- Server/API changes — purely frontend (`queue.ts`, `player.ts`, `views.ts`, CSS).
  `streamablePartCount` (already shipped) stays the card signal.
- Cross-device queue sync (still localStorage); merged now-playing+Fronta (Option C).
- **Per-part reordering** (cut per M4) — group reorder + part remove covers the asks.

## Microcopy (cs) — UX-review N1
- Per-part ＋: aria `Přidat tento díl do fronty`, title `Přidat díl do fronty`.
- Group sub-heading count: `díly 1–N` (range sidesteps case agreement) or `N dílů`.
- Card success: `✓ (+K)` (newly added). Card already-queued: `✓`.
- Empty-state hint: `Přidejte celý pořad nebo jednotlivý díl tlačítkem ＋.`

## Testing / acceptance
- "Add all (N)" → Fronta shows the show grouped with its N part rows (collapsed if >4);
  badge +N; playing walks all N gaplessly with "díl k/N".
- Per-part ＋ adds exactly that díl as a row under its show; dedups (no bump on repeat).
- "Add all" after adding some parts individually → merges, adds only the remaining (`+K`).
- Remove ✕ drops one díl; emptying a group drops the group. Whole-group ▲/▼ reorders.
- Play-now on a group plays its queued parts and clears that group.
- Single-audio shows add as one row, no díl label. Build + typecheck clean.

## Delivery
Feature worktree → `queue.ts` + `player.ts` + `views.ts` + CSS → PR → Pages deploy.
