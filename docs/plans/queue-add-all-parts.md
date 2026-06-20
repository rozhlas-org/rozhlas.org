# Plan: "Add all parts to queue" on cards + detail

## Problem (observed)
1. **Multi-part shows have no add-to-queue button on the list/grid card.** In `views.ts`
   `ShowCard`, the button (and the ▶ badge) are gated on `s.streamable`:
   ```js
   const add = s.streamable ? queueAddBtn(...) : "";
   ```
   But `ShowListItem.streamable` is the **show-level** audio flag (`audio_files` where
   `part_id IS NULL`). A serialized show (četba) has audio on its **parts**, not the show,
   so `streamable` is `false` → the card renders no queue button at all.
2. **The button doesn't convey it queues all parts.** The queue (`queue.ts`) is by **whole
   show** (slug); when a queued show plays, `player.ts buildParts()` returns **all**
   streamable parts and the player auto-advances through them. So adding a show already
   queues all its parts — but the label ("＋ Přidat do fronty") and the single queue-panel
   row make it look like only one/the first part was added. The detail-page button
   (`queueAddBtn(..., { label: "＋ Přidat do fronty" })`) has the same labeling gap.

So nothing is functionally "first part only" — but the affordance is **missing on cards**
and **unlabeled** on both surfaces.

## Goal
- Cards: for multi-part (and single-audio) streamable shows, show an **"add all to queue"**
  button labeled with the **part count**, e.g. `＋ Vše do fronty (12)`.
- Detail: relabel the existing button to mirror it, e.g. `＋ Přidat všech 12 dílů do fronty`.
- Keep the **show-based queue model** (one entry = the whole show, plays all parts). "Add
  all parts" = enqueue the show; the count is display-only. (Do **not** expand to N
  per-part queue entries — bigger change, and playback already covers all parts.)

## Changes

### 1. API — expose a part count on list items
`packages/api/src/queries.ts`:
- Add `streamablePartCount: number` to `ShowListItem` (count of parts with
  `streamable = true`); keep `streamable` (show-level) as is.
- **Widen `audioForShows`** to also return `streamablePartCount` per show in the **same
  batched pass** (instead of a separate third query): one grouped count over
  `audio_files` where `inArray(show_id, ids) AND isNotNull(part_id) AND
  eq(streamable, true)`. Use Drizzle `eq(audioFiles.streamable, true)` /
  `isNotNull(audioFiles.partId)` — **not** raw `= 1` (column is boolean-mode). `count` is
  already imported; `isNotNull` is a trivial add. Keeps all "is-playable" logic in one
  function and the per-page cost at two lookups (audio + artwork), no N+1.
- **The only two `ShowListItem` producers are `listShows` and `showItemsByIds`** — update
  both. Everything routes through them: `/api/shows`, `/api/search` → `listShows`;
  `/api/omnisearch` → `showItemsByIds`; `/api/shows/:slug/similar` → `similarShows` →
  `showItemsByIds`. There is **no** separate search builder. Routes serialize via
  `c.json(...)`, so the new field flows out with no route changes.
- A show is "playable from a card" when `streamable || streamablePartCount > 0`; the
  display count `N = streamablePartCount || (streamable ? 1 : 0)` (**parts win** when
  present — matches `buildParts`, which prefers parts, so the card count == actual
  playback length).

### 2. Frontend types
`packages/web/src/scripts/api.ts`: add `streamablePartCount: number` to `ShowListItem`.

### 3. Cards
`packages/web/src/scripts/views.ts` `ShowCard`:
- Compute `playable = s.streamable || s.streamablePartCount > 0` and
  `n = s.streamablePartCount || (s.streamable ? 1 : 0)`.
- Render the badge/button on `playable` (not `streamable`), fixing both the missing button
  **and** the missing ▶ badge for multi-part shows.
- Label: `n > 1 ? `＋ Vše do fronty (${n})` : "＋"` (icon-only for single-audio to keep
  cards compact; tooltip always full).

### 4. Detail
`views.ts` `showView`: relabel the detail button with a count-aware label. **`n` is
computed client-side** from the already-loaded `ShowDetail`:
`show.parts.filter(p => p.audio?.streamable).length` — **no API dependency for the detail
page**. Behaviour unchanged (still `queueAddBtn(show.slug, …)` → queues the whole show).

### 5. Shared label helper (with Czech pluralization — REQUIRED)
Add `queueAddLabel(n, { compact })` in `views.ts` so card and detail stay in sync;
`queueAddBtn` already accepts `label`/`cls` (no change to it). The helper MUST do proper
cs-CZ 3-form pluralization of "díl":
- `n === 1` → `díl`  · `n` 2–4 → `díly`  · `n ≥ 5` (and 0) → `dílů`

So: compact/card → `n > 1 ? `＋ Vše do fronty (${n})` : "＋"`; detail →
`n > 1 ? `＋ Přidat do fronty (${n} ${dilWord(n)})` : "＋ Přidat do fronty"`. **Avoid**
`všech ${n} dílů` — grammatically wrong for n 2–4 (`všech 2 dílů` ✗; `2 díly` ✓). The
parenthesized `(${n} dílů/díly)` form sidesteps the agreement problem.

## Out of scope
- Per-part queue entries / reordering individual díly (queue stays show-based).
- Changing playback (already plays all parts and auto-advances).

## Risks / notes
- **API↔frontend coupling + deploy order:** the card reads `streamablePartCount`; if the
  frontend ships before the API field exists, `n` is `undefined` → guard with
  `?? 0`. Deploy API (docker) before/with the frontend (Pages); the guard makes order safe.
- **Consistency:** both `ShowListItem` producers (`listShows`, `showItemsByIds`) must set
  the field. The runtime guard is the **read site** (`s.streamablePartCount ?? 0` in
  `showCard`/`showView`) — a TS interface "default" is not real at runtime, so don't rely
  on it.
- **i18n/labels:** Czech 3-form pluralization is **required** (see §5), not optional.

## Testing / acceptance
- A multi-part show card shows `＋ Vše do fronty (N)` and the ▶ badge; clicking it queues
  the show and the badge bumps.
- Playing that queued show plays **all** N parts in order (existing behaviour — regression
  check).
- Single-audio show card shows the `＋` (n=1) and still works.
- Detail button reads `Přidat všech N dílů do fronty` and queues the whole show.
- Build + typecheck clean; deployed via Pages (frontend) after the API field is live.

## Delivery
Feature worktree → API change (deploys via docker) + web change (deploys via Pages on
merge) → PR → verify on rozhlas.org.
