import { Hono } from "hono";
import { config } from "@rozhlas/core";
import {
  dashboardData,
  type DashboardData,
  type CatalogStats,
} from "./stats.ts";

// Operator dashboard at /admin — catalog + pipeline + run stats. Server-rendered,
// self-contained styling (it's not part of the public Pages site). Auto-refreshes.

function fmtBytes(n: number | null): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtDateTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
}

function relTime(d: Date | string | null): string {
  if (!d) return "nikdy";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `před ${s}s`;
  if (s < 3600) return `před ${Math.floor(s / 60)} min`;
  if (s < 86400) return `před ${Math.floor(s / 3600)} h`;
  return `před ${Math.floor(s / 86400)} d`;
}

function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function Card({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div class="card">
      <div class="card__label">{label}</div>
      <div class="card__value">{value}</div>
      {sub ? <div class="card__sub">{sub}</div> : null}
    </div>
  );
}

function Cards({ c }: { c: CatalogStats }) {
  return (
    <div class="cards">
      <Card label="Pořady" value={c.shows} sub={`${c.showsStreamable} s přehratelným audiem`} />
      <Card label="Přehratelné" value={c.audioStreamable} sub={`${pct(c.audioStreamable, c.audioTotal)} z ${c.audioTotal} stop`} />
      <Card label="Připnuto (IPFS)" value={c.audioPinned} sub={`${c.audioPending} čeká na stažení`} />
      <Card label="Úložiště" value={fmtBytes(c.storageBytes)} sub="připnuté audio" />
      <Card label="Programy" value={c.programmes} sub={`${c.people} osob`} />
      <Card label="Embeddings" value={c.embedded} sub={`${pct(c.embedded, c.shows)} pro omnisearch`} />
    </div>
  );
}

function RunsTable({ data }: { data: DashboardData }) {
  if (!data.runs.length) return <p class="empty">Zatím žádné běhy scraperu.</p>;
  return (
    <table>
      <thead>
        <tr><th>Zdroj</th><th>Začátek</th><th>Trvání</th><th>Stav</th><th>Nalezeno</th><th>Nové (diff)</th><th>Chyba</th></tr>
      </thead>
      <tbody>
        {data.runs.map((r) => {
          const dur = r.finishedAt
            ? `${Math.max(0, Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000))}s`
            : "běží…";
          return (
            <tr>
              <td>{r.sourceKey}</td>
              <td title={fmtDateTime(r.startedAt)}>{relTime(r.startedAt)}</td>
              <td>{dur}</td>
              <td><span class={`badge badge--${r.status}`}>{r.status}</span></td>
              <td>{r.discovered}</td>
              <td><strong>{r.succeeded}</strong></td>
              <td class="err">{r.error ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SourcesTable({ data }: { data: DashboardData }) {
  return (
    <table>
      <thead>
        <tr><th>Zdroj</th><th>Pořadů</th><th>Plán (cron)</th><th>Poslední běh</th><th>Stav</th></tr>
      </thead>
      <tbody>
        {data.sources.map((s) => (
          <tr>
            <td>{s.title ?? s.key} <span class="muted">{s.key}</span></td>
            <td>{s.shows}</td>
            <td><code>{s.schedule ?? "—"}</code></td>
            <td title={fmtDateTime(s.lastRunAt)}>{relTime(s.lastRunAt)}</td>
            <td><span class={`badge badge--${s.enabled ? "ok" : "off"}`}>{s.enabled ? "aktivní" : "vypnuto"}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QueuesTable({ data }: { data: DashboardData }) {
  return (
    <table>
      <thead>
        <tr><th>Fronta</th><th>Čeká</th><th>Běží</th><th>Odloženo</th><th>Hotovo</th><th>Selhalo</th></tr>
      </thead>
      <tbody>
        {data.queues.map((q) => (
          <tr>
            <td>{q.name}</td>
            <td>{q.waiting}</td>
            <td>{q.active}</td>
            <td>{q.delayed}</td>
            <td class="muted">{q.completed}</td>
            <td class={q.failed ? "err" : "muted"}>{q.failed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Page({ data }: { data: DashboardData }) {
  const failedJobs = data.queues.reduce((n, q) => n + q.failed, 0);
  return (
    <html lang="cs">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta http-equiv="refresh" content="30" />
        <title>Operator — rozhlas.org</title>
        <style>{CSS}</style>
      </head>
      <body>
        <header class="topbar">
          <h1>rozhlas<span class="accent">.org</span> · operator</h1>
          <nav>
            <a href="/admin/selections">Výběry</a>
            <a href="/admin/category-groups">Kategorie</a>
            <a href="/admin/jobs">Fronty (Bull Board) →</a>
            <a href="/admin">↻ Obnovit</a>
            <a href="/admin/logout" class="logout">Odhlásit</a>
          </nav>
        </header>
        <main>
          {failedJobs > 0 ? (
            <p class="alert">⚠ {failedJobs} selhaných jobů — zkontroluj <a href="/admin/jobs">Bull Board</a>.</p>
          ) : null}

          <Cards c={data.catalog} />

          <section>
            <h2>Poslední běhy scraperu</h2>
            <RunsTable data={data} />
          </section>

          <div class="two-col">
            <section>
              <h2>Zdroje</h2>
              <SourcesTable data={data} />
            </section>
            <section>
              <h2>Pipeline fronty</h2>
              <QueuesTable data={data} />
            </section>
          </div>

          <div class="two-col">
            <section>
              <h2>Naposledy přidané pořady</h2>
              <ul class="list">
                {data.recentShows.map((s) => (
                  <li>
                    <a href={`https://rozhlas.org/show/${encodeURIComponent(s.slug)}`} target="_blank" rel="noopener">{s.title}</a>
                    <span class="muted">{s.showName ?? s.sourceKey} · {relTime(s.createdAt)}</span>
                  </li>
                ))}
                {data.recentShows.length === 0 ? <li class="empty">—</li> : null}
              </ul>
            </section>
            <section>
              <h2>Naposledy připnuté audio</h2>
              <ul class="list">
                {data.recentPins.map((p) => (
                  <li>
                    <a href={`https://rozhlas.org/show/${encodeURIComponent(p.slug)}`} target="_blank" rel="noopener">{p.title}</a>
                    <span class="muted">{fmtBytes(p.sizeBytes)} · {p.streamable ? "✓ streamable" : "neověřeno"} · {relTime(p.at)}</span>
                  </li>
                ))}
                {data.recentPins.length === 0 ? <li class="empty">Zatím nic připnutého.</li> : null}
              </ul>
            </section>
          </div>

          <footer>
            DB: <code>{config.DATABASE_PATH}</code> · gateway: <code>{config.IPFS_GATEWAY_URL}</code> · vygenerováno {fmtDateTime(data.generatedAt)} · auto-refresh 30s
          </footer>
        </main>
      </body>
    </html>
  );
}

const CSS = `
:root{--ink:#111;--cyan:#00aeef;--magenta:#ec008c;--muted:#6b6b66;--line:#e1e0da;--paper:#fff}
*{box-sizing:border-box}
body{margin:0;font-family:Saira,system-ui,sans-serif;color:var(--ink);background:#f6f6f3}
a{color:var(--ink)}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:18px 28px;background:var(--paper);border-bottom:3px solid var(--ink)}
.topbar h1{font-family:Saira Condensed,system-ui,sans-serif;font-weight:900;text-transform:uppercase;font-size:26px;margin:0}
.accent{color:var(--cyan)}
.topbar nav{display:flex;gap:18px;font-family:Space Mono,monospace;font-size:12px;text-transform:uppercase;letter-spacing:1px}
.topbar nav a{color:var(--muted)} .topbar nav a:hover{color:var(--ink)} .logout{color:var(--magenta)!important}
main{max-width:1180px;margin:0 auto;padding:28px}
.alert{background:#fff3f8;border:2px solid var(--magenta);padding:10px 14px;font-weight:600;margin:0 0 22px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:30px}
.card{background:var(--paper);border:3px solid var(--ink);box-shadow:5px 5px 0 var(--cyan);padding:16px}
.card__label{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}
.card__value{font-family:Saira Condensed,system-ui,sans-serif;font-weight:900;font-size:38px;line-height:1.05}
.card__sub{font-size:12px;color:var(--muted)}
section{margin-bottom:30px}
h2{font-family:Saira Condensed,system-ui,sans-serif;font-weight:800;text-transform:uppercase;font-size:20px;margin:0 0 12px;border-bottom:2px solid var(--ink);padding-bottom:6px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:28px}
@media(max-width:820px){.two-col{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;background:var(--paper);border:2px solid var(--ink);font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);background:#fafaf8}
td code{font-size:12px}
.muted{color:var(--muted);font-size:12px}
.err{color:var(--magenta);font-size:12px}
.badge{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;padding:2px 7px;border:1px solid var(--ink)}
.badge--ok,.badge--running{background:var(--cyan)} .badge--error{background:var(--magenta);color:#fff} .badge--off{background:var(--line)}
.list{list-style:none;margin:0;padding:0}
.list li{display:flex;flex-direction:column;padding:8px 0;border-bottom:1px solid var(--line)}
.list li a{font-weight:600}
.empty{color:var(--muted);font-style:italic}
footer{font-family:Space Mono,monospace;font-size:11px;color:var(--muted);margin-top:30px;border-top:2px solid var(--ink);padding-top:12px}
`;

export const adminDashboard = new Hono();

adminDashboard.get("/", async (c) => {
  const data = await dashboardData();
  return c.html("<!doctype html>" + (<Page data={data} />).toString());
});

adminDashboard.get("/stats.json", async (c) => c.json(await dashboardData()));
