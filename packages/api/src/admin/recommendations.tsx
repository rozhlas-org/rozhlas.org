import { Hono, type Context } from "hono";
import {
  adminListRecommendations,
  adminGetRecommendation,
  adminCreateRecommendation,
  adminUpdateRecommendation,
  adminDeleteRecommendation,
  adminSearchShows,
} from "../queries.ts";

// Admin CRUD for editorial recommendations ("Co k poslechu"). Server-rendered (Hono JSX),
// behind the /admin session guard, mounted at /admin/recommendations. Mutations are
// POST → redirect (PRG). A recommendation = an existing show + an optional "why listen"
// note; created by picking a show, then the note/publish are edited. Ordered by creation
// time (no manual reorder). A small vanilla-JS island enhances the picker; degrades to forms.

const CSS = `
:root{--ink:#111;--cyan:#00aeef;--magenta:#ec008c;--yellow:#ffe000;--muted:#6b6b66;--line:#e1e0da;--paper:#fff}
*{box-sizing:border-box}
body{margin:0;font-family:Saira,system-ui,sans-serif;color:var(--ink);background:#f6f6f3}
a{color:var(--ink)}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:18px 28px;background:var(--paper);border-bottom:3px solid var(--ink)}
.topbar h1{font-family:Saira Condensed,system-ui,sans-serif;font-weight:900;text-transform:uppercase;font-size:26px;margin:0}
.accent{color:var(--cyan)}
.topbar nav{display:flex;gap:18px;font-family:Space Mono,monospace;font-size:12px;text-transform:uppercase;letter-spacing:1px}
.topbar nav a{color:var(--muted)} .topbar nav a:hover{color:var(--ink)} .logout{color:var(--magenta)!important}
main{max-width:1000px;margin:0 auto;padding:28px}
h2{font-family:Saira Condensed,system-ui,sans-serif;font-weight:800;text-transform:uppercase;font-size:22px;margin:0 0 14px;border-bottom:2px solid var(--ink);padding-bottom:6px}
.flash{background:#fff3f8;border:2px solid var(--magenta);padding:10px 14px;font-weight:600;margin:0 0 20px}
.warn{background:#fffbe6;border:2px solid var(--yellow);padding:10px 14px;font-weight:600;margin:0 0 16px}
table{width:100%;border-collapse:collapse;background:var(--paper);border:2px solid var(--ink);font-size:14px}
th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);background:#fafaf8}
.badge{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;padding:2px 7px;border:1px solid var(--ink);display:inline-block}
.badge--ok{background:var(--cyan)} .badge--off{background:var(--line)} .badge--warn{background:var(--magenta);color:#fff}
.btn{font-family:Saira Condensed,system-ui,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.5px;font-size:13px;padding:7px 12px;background:var(--ink);color:#fff;border:2px solid var(--ink);box-shadow:3px 3px 0 var(--cyan);cursor:pointer;text-decoration:none;display:inline-block}
.btn:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--cyan)}
.btn--ghost{background:var(--paper);color:var(--ink);box-shadow:none}
.btn--danger{box-shadow:3px 3px 0 var(--magenta)}
.btn--sm{font-size:11px;padding:4px 8px;box-shadow:2px 2px 0 var(--cyan)}
form.inline{display:inline}
label{display:block;font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:14px 0 4px}
input[type=text],textarea{width:100%;padding:9px;border:2px solid var(--ink);font-size:15px;font-family:inherit;background:var(--paper)}
textarea{min-height:80px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.check{display:flex;align-items:center;gap:8px;margin:16px 0}
.check input{width:auto}
.muted{color:var(--muted);font-size:12px}
.thumb{width:46px;height:46px;object-fit:cover;border:2px solid var(--ink);background:repeating-linear-gradient(45deg,#ecebe6,#ecebe6 10px,#e1e0da 10px,#e1e0da 20px)}
.card{background:var(--paper);border:2px solid var(--ink);padding:18px;margin-bottom:22px}
.results{list-style:none;margin:8px 0 0;padding:0;border:2px solid var(--ink);max-height:340px;overflow:auto;background:var(--paper)}
.results li{padding:8px 10px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center;justify-content:space-between}
.results li .t{font-weight:600}
.empty{color:var(--muted);font-style:italic}
.hint{font-family:Space Mono,monospace;font-size:11px;color:var(--muted);margin-top:4px}
`;

function Layout({ title, children }: { title: string; children: unknown }) {
  return (
    <html lang="cs">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} — admin</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header class="topbar">
          <h1>
            rozhlas<span class="accent">.org</span> · Doporučení
          </h1>
          <nav>
            <a href="/admin">Přehled</a>
            <a href="/admin/jobs">Fronty</a>
            <a href="/admin/selections">Výběry</a>
            <a href="/admin/recommendations">Doporučení</a>
            <a class="logout" href="/admin/logout">Odhlásit</a>
          </nav>
        </header>
        <main>{children as never}</main>
      </body>
    </html>
  );
}

function doc(node: unknown): string {
  return "<!doctype html>" + (node as { toString(): string }).toString();
}

const fmtDate = (d: Date) => {
  const t = d instanceof Date ? d : new Date(d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

// ---- pages ----

function ListPage({ rows, flash }: { rows: Awaited<ReturnType<typeof adminListRecommendations>>; flash?: string }) {
  return (
    <Layout title="Doporučení">
      <h2>Co k poslechu</h2>
      {flash ? <p class="flash">{flash}</p> : null}
      <p>
        <a class="btn" href="/admin/recommendations/new">
          + Nové doporučení
        </a>
      </p>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Pořad</th>
            <th>Proč poslouchat</th>
            <th>Stav</th>
            <th>Přidáno</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr id={`rec-${r.id}`}>
              <td>{r.artworkUrl ? <img class="thumb" src={r.artworkUrl} alt="" /> : <div class="thumb" />}</td>
              <td>
                <a href={`/admin/recommendations/${r.id}`}>{r.title}</a>
                {r.showName ? <div class="muted">{r.showName}</div> : null}
                {!r.streamable ? <div class="muted">⚠ aktuálně nepřehratelné</div> : null}
              </td>
              <td>{r.description ? <span class="muted">{r.description.slice(0, 80)}{r.description.length > 80 ? "…" : ""}</span> : <span class="empty">—</span>}</td>
              <td>{r.published ? <span class="badge badge--ok">publikováno</span> : <span class="badge badge--off">koncept</span>}</td>
              <td class="muted">{fmtDate(r.createdAt)}</td>
              <td>
                <a class="btn btn--ghost btn--sm" href={`/admin/recommendations/${r.id}`}>
                  Upravit
                </a>{" "}
                <form class="inline" method="post" action={`/admin/recommendations/${r.id}/delete`} onsubmit="return confirm('Smazat doporučení?')">
                  <button class="btn btn--danger btn--sm" type="submit">
                    Smazat
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colspan={6} class="empty">
                Zatím žádná doporučení.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Layout>
  );
}

/** New: pick a show to recommend (search → "+ doporučit"). */
function NewPage({ q, results, flash }: { q?: string; results?: Awaited<ReturnType<typeof adminSearchShows>>; flash?: string }) {
  return (
    <Layout title="Nové doporučení">
      <p class="muted">
        <a href="/admin/recommendations">← Doporučení</a>
      </p>
      <h2>Nové doporučení</h2>
      {flash ? <p class="flash">{flash}</p> : null}
      <div class="card" id="add">
        <p class="muted" style="margin-top:0">Vyber pořad, který chceš doporučit. Poznámku „proč poslouchat“ doplníš v dalším kroku.</p>
        {/* No-JS fallback: GET search reloads with results; the island enhances it. */}
        <form method="get" action="/admin/recommendations/new" id="rec-searchform">
          <div class="row">
            <input type="text" name="q" id="rec-search" value={q ?? ""} placeholder="Najít pořad…" autocomplete="off" />
            <button class="btn btn--ghost" type="submit">
              Hledat
            </button>
          </div>
        </form>
        <div id="rec-results">
          {results ? (
            <ul class="results">
              {results.map((r) => (
                <li>
                  <span class="t">
                    {r.title}
                    {r.showName ? <span class="muted"> · {r.showName}</span> : null}
                  </span>
                  <form class="inline" method="post" action="/admin/recommendations">
                    <input type="hidden" name="showId" value={String(r.id)} />
                    <button class="btn btn--sm" type="submit">
                      + doporučit
                    </button>
                  </form>
                </li>
              ))}
              {results.length === 0 ? <li class="empty">Nic nenalezeno.</li> : null}
            </ul>
          ) : null}
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: islandJs() }} />
    </Layout>
  );
}

type RecRow = NonNullable<Awaited<ReturnType<typeof adminGetRecommendation>>>;

/** Edit: the show is fixed; edit the "why listen" note + published flag. */
function EditPage({ rec, flash }: { rec: RecRow; flash?: string }) {
  return (
    <Layout title={rec.title}>
      <p class="muted">
        <a href="/admin/recommendations">← Doporučení</a>
      </p>
      <h2>Upravit doporučení</h2>
      {flash ? <p class="flash">{flash}</p> : null}
      {!rec.streamable ? (
        <p class="warn">⚠ Tento pořad teď nemá přehratelné audio — na webu se zobrazí, ale nepůjde přehrát.</p>
      ) : null}
      <div class="card">
        <p style="margin-top:0">
          <strong>{rec.title}</strong>
          {rec.showName ? <span class="muted"> · {rec.showName}</span> : null}
          {" "}
          <a class="muted" href={`/show/${rec.slug}`} target="_blank" rel="noopener">
            otevřít ↗
          </a>
        </p>
        <form method="post" action={`/admin/recommendations/${rec.id}`}>
          <label>Proč to poslouchat (nepovinné)</label>
          <textarea name="description" maxlength={300} placeholder="Krátká poznámka, proč pořad stojí za poslech…">{rec.description ?? ""}</textarea>
          <div class="check">
            <input type="checkbox" name="published" id="published" value="1" checked={rec.published} />
            <label for="published" style="margin:0">Publikováno (zobrazit na webu)</label>
          </div>
          <button class="btn" type="submit">
            Uložit
          </button>{" "}
          <a class="btn btn--ghost" href="/admin/recommendations">
            Hotovo
          </a>
        </form>
      </div>
    </Layout>
  );
}

/** Tiny no-framework enhancement: live show search on the New page, no reloads. */
function islandJs(): string {
  return `
(function(){
  var input=document.getElementById('rec-search');
  var out=document.getElementById('rec-results');
  var form=document.getElementById('rec-searchform');
  if(!input||!out||!form)return;
  form.addEventListener('submit',function(e){e.preventDefault();run();});
  var t;
  input.addEventListener('input',function(){clearTimeout(t);t=setTimeout(run,250);});
  function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function run(){
    var q=input.value.trim();
    if(!q){out.innerHTML='';return;}
    fetch('/admin/recommendations/_search?q='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(rows){
      if(!rows.length){out.innerHTML='<ul class="results"><li class="empty">Nic nenalezeno.</li></ul>';return;}
      out.innerHTML='<ul class="results">'+rows.map(function(r){
        return '<li><span class="t">'+esc(r.title)+(r.showName?' <span class=muted>· '+esc(r.showName)+'</span>':'')+'</span>'+
          '<button class="btn btn--sm js-add" data-show="'+r.id+'">+ doporučit</button></li>';
      }).join('')+'</ul>';
    });
  }
  out.addEventListener('click',function(e){
    var b=e.target.closest('.js-add'); if(!b)return;
    e.preventDefault();
    var f=document.createElement('form');f.method='post';f.action='/admin/recommendations';
    f.innerHTML='<input name="showId" value="'+b.getAttribute('data-show')+'">';
    document.body.appendChild(f);f.submit();
  });
})();
`;
}

// ---- routes ----

function parseRec(body: Record<string, unknown>) {
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 300) : null;
  const published = body.published === "1" || body.published === "on";
  return { description, published };
}

export const adminRecommendations = new Hono();

// CSRF: reject cross-origin state changes (Lax cookies aren't enough for destructive POSTs).
adminRecommendations.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin") || c.req.header("referer") || "";
    const host = c.req.header("host") || "";
    if (origin) {
      try {
        if (new URL(origin).host !== host) return c.text("bad origin", 403);
      } catch {
        return c.text("bad origin", 403);
      }
    }
  }
  return next();
});

const back = (c: { redirect: (u: string, s?: 301 | 302) => Response }, url: string) => c.redirect(url, 302);

adminRecommendations.get("/", async (c) => {
  return c.html(doc(<ListPage rows={await adminListRecommendations()} flash={c.req.query("flash")} />));
});

adminRecommendations.get("/new", async (c) => {
  const q = c.req.query("q");
  const results = q != null ? await adminSearchShows(q) : undefined;
  return c.html(doc(<NewPage q={q} results={results} flash={c.req.query("flash")} />));
});

// JSON: live show search for the picker island.
adminRecommendations.get("/_search", async (c) => c.json(await adminSearchShows(c.req.query("q") ?? "")));

// Create from a picked show (empty note, published immediately). Dedupe → friendly flash.
adminRecommendations.post("/", async (c) => {
  const body = await c.req.parseBody();
  const showId = Number(body.showId);
  if (!Number.isFinite(showId)) return back(c, "/admin/recommendations/new");
  const id = await adminCreateRecommendation(showId, null, true);
  if (id == null) {
    return back(c, `/admin/recommendations/new?flash=${encodeURIComponent("Tento pořad už je v doporučeních.")}`);
  }
  return back(c, `/admin/recommendations/${id}`);
});

async function renderEdit(c: Context, id: number, flash?: string) {
  const rec = await adminGetRecommendation(id);
  if (!rec) return c.redirect("/admin/recommendations", 302);
  return c.html(doc(<EditPage rec={rec} flash={flash} />));
}

adminRecommendations.get("/:id", async (c) => renderEdit(c, Number(c.req.param("id")), c.req.query("flash")));

adminRecommendations.post("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const rec = await adminGetRecommendation(id);
  if (!rec) return back(c, "/admin/recommendations");
  await adminUpdateRecommendation(id, parseRec(await c.req.parseBody()));
  return back(c, `/admin/recommendations/${id}?flash=${encodeURIComponent("Uloženo.")}`);
});

adminRecommendations.post("/:id/delete", async (c) => {
  await adminDeleteRecommendation(Number(c.req.param("id")));
  return back(c, "/admin/recommendations");
});
