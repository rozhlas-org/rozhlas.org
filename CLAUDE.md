# rozhlas.org

Scraper + web player for Czech Radio (rozhlas.cz) shows. Scrapes shows on a schedule,
stores metadata in SQLite, pushes audio to a self-hosted IPFS node (never stored
publicly on the server), and serves a public static site + API. Classic browse/search
now; AI natural-language "omnisearch" later.

**Full design: [docs/PLAN.md](docs/PLAN.md)** — read it before architectural work.

## Stack & conventions
- **Runtime:** TypeScript on **Bun** (monorepo via Bun workspaces; see PLAN §4).
- **DB:** SQLite (Drizzle ORM) — single source of truth for app metadata.
- **Jobs:** BullMQ (Redis) + Bull Board dashboard at `/admin/jobs`. Scrapers are
  scheduled (repeatable) jobs; pipeline stages in PLAN §7.
- **IPFS:** self-hosted Kubo. Audio temp files are deleted right after `ipfs-add` —
  never serve audio from the app's own disk; stream by CID via the gateway.
- **Audio:** source is **DASH/HLS `.m4s` segments** from each show's detail page (not a
  direct mp3) — fetched & assembled with **ffmpeg** in the `acquire-audio` job (PLAN §7);
  ffmpeg lives in the worker image. Prefer remux to `.m4a` (stream copy) over re-encoding.
- **Frontend:** Astro (static) + Hono (JSON API).
- **Scrapers:** a **page-key → strategy registry** (PLAN §5) — every source/page is
  different, so register a simplified key + its own scrape strategy. `fetchShow` returns
  a `MediaSource` (manifest URL + headers), not a file. Static → `fetch`+`cheerio`;
  JS-rendered → Playwright (installed on this machine via gstack). Respect robots.txt,
  rate-limit, identify the crawler.
- **Deploy:** Docker Compose on this server (web · worker · redis · ipfs · sqlite vol).
- **AI (later):** Voyage AI embeddings + `sqlite-vec`; Claude `claude-opus-4-8` for
  query-understanding only (Anthropic has no embeddings endpoint). Never hardcode another
  provider for embeddings without revisiting PLAN §9.
- **Secrets:** `.env` (gitignored) — `GITHUB_TOKEN`, future `VOYAGE_API_KEY`,
  `ANTHROPIC_API_KEY`; injected via Compose.

## Git & GitHub

- **Commit identity:** Always commit as the anonymous agent **rozhlas-org-agent**
  (`user.name = rozhlas-org-agent`, `user.email = 294467278+rozhlas-org-agent@users.noreply.github.com`). Set globally.
- **No AI attribution:** Never add `Co-Authored-By: Claude` (or any Claude/Anthropic
  attribution) to commit messages or PR bodies. No "Generated with Claude Code" lines.
- **gh CLI:** Authenticated as the `rozhlas-org-agent` GitHub account. The token lives in
  `.env` as `GITHUB_TOKEN` and is also stored in gh's config (`~/.config/gh/hosts.yml`),
  so `gh` works without exporting the env var. Use `gh` for all GitHub operations.

## gstack

- Use the **`/browse`** skill from gstack for **all web browsing**.
- **Never** use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`,
`/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`,
`/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`,
`/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`,
`/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`,
`/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`,
`/unfreeze`, `/gstack-upgrade`, `/learn`
