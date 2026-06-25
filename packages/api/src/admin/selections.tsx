import { Hono, type Context } from "hono";
import {
  adminListSelections,
  adminGetSelection,
  adminGetSelectionItems,
  adminCreateSelection,
  adminUpdateSelection,
  adminDeleteSelection,
  adminReorderSelection,
  adminAddItem,
  adminRemoveItem,
  adminReorderItem,
  adminSearchShows,
  adminShowParts,
  adminSetSelectionThumbnail,
  streamUrl,
} from "../queries.ts";
import { ipfs } from "@rozhlas/ipfs";
import { thumbnailFromBuffer, discardTemp } from "@rozhlas/media";
import { createLogger } from "@rozhlas/core";

const log = createLogger("admin:selections");

// Admin CRUD for editorial selections ("Výběry"). Server-rendered (Hono JSX), behind
// the /admin session guard, mounted at /admin/selections. Mutations are POST → redirect
// (PRG). A small vanilla-JS island enhances the add-item picker; it degrades to plain
// forms without JS.

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
table{width:100%;border-collapse:collapse;background:var(--paper);border:2px solid var(--ink);font-size:14px}
th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);background:#fafaf8}
.badge{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;padding:2px 7px;border:1px solid var(--ink);display:inline-block}
.badge--ok{background:var(--cyan)} .badge--off{background:var(--line)} .badge--dil{background:var(--magenta);color:#fff} .badge--whole{background:var(--yellow)}
.btn{font-family:Saira Condensed,system-ui,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.5px;font-size:13px;padding:7px 12px;background:var(--ink);color:#fff;border:2px solid var(--ink);box-shadow:3px 3px 0 var(--cyan);cursor:pointer;text-decoration:none;display:inline-block}
.btn:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--cyan)}
.btn--ghost{background:var(--paper);color:var(--ink);box-shadow:none}
.btn--danger{box-shadow:3px 3px 0 var(--magenta)}
.btn--sm{font-size:11px;padding:4px 8px;box-shadow:2px 2px 0 var(--cyan)}
.iconbtn{font-family:Space Mono,monospace;font-size:13px;padding:3px 8px;background:var(--paper);border:2px solid var(--ink);cursor:pointer}
.iconbtn:disabled{opacity:.3;cursor:default}
form.inline{display:inline}
label{display:block;font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:14px 0 4px}
input[type=text],input[type=url],textarea,select{width:100%;padding:9px;border:2px solid var(--ink);font-size:15px;font-family:inherit;background:var(--paper)}
textarea{min-height:72px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.check{display:flex;align-items:center;gap:8px;margin:16px 0}
.check input{width:auto}
.muted{color:var(--muted);font-size:12px}
.thumb{width:160px;height:100px;object-fit:cover;border:2px solid var(--ink);background:repeating-linear-gradient(45deg,#ecebe6,#ecebe6 10px,#e1e0da 10px,#e1e0da 20px)}
.card{background:var(--paper);border:2px solid var(--ink);padding:18px;margin-bottom:22px}
.results{list-style:none;margin:8px 0 0;padding:0;border:2px solid var(--ink);max-height:320px;overflow:auto;background:var(--paper)}
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
            rozhlas<span class="accent">.org</span> · Výběry
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

const dilLabel = (idx: number | null, title: string | null) =>
  idx == null ? "celý pořad" : title ? `${idx}. díl — ${title}` : `${idx}. díl`;

// ---- pages ----

function ListPage({ rows, flash }: { rows: Awaited<ReturnType<typeof adminListSelections>>; flash?: string }) {
  return (
    <Layout title="Výběry">
      <h2>Výběry</h2>
      {flash ? <p class="flash">{flash}</p> : null}
      <p>
        <a class="btn" href="/admin/selections/new">
          + Nový výběr
        </a>
      </p>
      <table>
        <thead>
          <tr>
            <th>Název</th>
            <th>Pořadů</th>
            <th>Stav</th>
            <th>Pořadí</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr id={`sel-${s.id}`}>
              <td>
                <a href={`/admin/selections/${s.id}`}>{s.title}</a>
                <div class="muted">/vyber/{s.slug}</div>
              </td>
              <td>{s.itemCount}</td>
              <td>
                {s.published ? <span class="badge badge--ok">publikováno</span> : <span class="badge badge--off">koncept</span>}
              </td>
              <td>
                <form class="inline" method="post" action={`/admin/selections/${s.id}/reorder`}>
                  <input type="hidden" name="dir" value="-1" />
                  <button class="iconbtn" type="submit" disabled={i === 0} aria-label="Nahoru">
                    ↑
                  </button>
                </form>{" "}
                <form class="inline" method="post" action={`/admin/selections/${s.id}/reorder`}>
                  <input type="hidden" name="dir" value="1" />
                  <button class="iconbtn" type="submit" disabled={i === rows.length - 1} aria-label="Dolů">
                    ↓
                  </button>
                </form>
              </td>
              <td>
                <a class="btn btn--ghost btn--sm" href={`/admin/selections/${s.id}`}>
                  Upravit
                </a>{" "}
                <form class="inline" method="post" action={`/admin/selections/${s.id}/delete`} onsubmit="return confirm('Smazat výběr?')">
                  <button class="btn btn--danger btn--sm" type="submit">
                    Smazat
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colspan={5} class="empty">
                Zatím žádné výběry.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Layout>
  );
}

type SelRow = NonNullable<Awaited<ReturnType<typeof adminGetSelection>>>;
type Items = Awaited<ReturnType<typeof adminGetSelectionItems>>;

function EditPage({
  sel,
  items,
  thumb,
  flash,
  q,
  results,
  parts,
  pickShow,
}: {
  sel: SelRow | null;
  items: Items;
  thumb: string | null;
  flash?: string;
  q?: string;
  results?: Awaited<ReturnType<typeof adminSearchShows>>;
  parts?: Awaited<ReturnType<typeof adminShowParts>>;
  pickShow?: { id: number; title: string } | null;
}) {
  const isNew = !sel;
  const action = isNew ? "/admin/selections" : `/admin/selections/${sel!.id}`;
  const canPublish = items.length > 0 || (sel?.published ?? false);
  return (
    <Layout title={isNew ? "Nový výběr" : sel!.title}>
      <p class="muted">
        <a href="/admin/selections">← Výběry</a>
      </p>
      <h2>{isNew ? "Nový výběr" : "Upravit výběr"}</h2>
      {flash ? <p class="flash">{flash}</p> : null}

      <div class="card">
        <form method="post" action={action} enctype="multipart/form-data">
          <label>Název</label>
          <input type="text" name="title" value={sel?.title ?? ""} required maxlength={120} />
          <label>Popis</label>
          <textarea name="description">{sel?.description ?? ""}</textarea>
          <label>Náhledový obrázek — nahrát (uloží se do IPFS)</label>
          <input type="file" name="thumbnailFile" accept="image/*" />
          <div class="hint">Nahraný obrázek se zmenší na čtverec a připne do IPFS. Má přednost před URL.</div>
          <label style="margin-top:14px">…nebo veřejná URL</label>
          <input type="url" name="thumbnailUrl" value={sel?.thumbnailUrl ?? ""} placeholder="https://… (jinak se použije obálka prvního pořadu)" />
          {!isNew && thumb ? (
            <div style="margin-top:10px">
              <img class="thumb" src={thumb} alt="" />
              <div class="hint">{sel?.thumbnailCid ? "nahraný (IPFS)" : sel?.thumbnailUrl ? "z URL" : "automaticky z prvního pořadu"}</div>
              {sel?.thumbnailCid || sel?.thumbnailUrl ? (
                <label class="check" style="margin-top:6px">
                  <input type="checkbox" name="removeThumbnail" value="1" /> Odebrat náhled
                </label>
              ) : null}
            </div>
          ) : null}
          <div class="check">
            <input type="checkbox" id="published" name="published" value="1" checked={sel?.published ?? false} disabled={!canPublish} />
            <label for="published" style="margin:0">
              Publikovat výběr
            </label>
          </div>
          {!canPublish ? <p class="hint">Přidej alespoň jeden pořad, než výběr publikuješ.</p> : null}
          <button class="btn" type="submit">
            {isNew ? "Vytvořit" : "Uložit"}
          </button>{" "}
          {!isNew ? (
            <a class="btn btn--ghost" href={`/admin/selections/${sel!.id}/preview`} target="_blank" rel="noopener">
              Náhled
            </a>
          ) : null}
        </form>
      </div>

      {isNew ? (
        <p class="muted">Pořady přidáš po vytvoření výběru.</p>
      ) : (
        <>
          <h2>Pořady ve výběru</h2>
          <table>
            <tbody>
              {items.map((it, i) => (
                <tr id={`item-${it.id}`}>
                  <td>
                    <a href={`/show/${it.slug}`} target="_blank" rel="noopener">
                      {it.title}
                    </a>
                    {it.showName ? <div class="muted">{it.showName}</div> : null}
                  </td>
                  <td>
                    {it.partIdx == null ? (
                      <span class="badge badge--whole">celý pořad</span>
                    ) : (
                      <span class="badge badge--dil">{dilLabel(it.partIdx, it.partTitle)}</span>
                    )}
                  </td>
                  <td style="white-space:nowrap">
                    <form class="inline" method="post" action={`/admin/selections/items/${it.id}/reorder`}>
                      <input type="hidden" name="dir" value="-1" />
                      <button class="iconbtn" type="submit" disabled={i === 0}>
                        ↑
                      </button>
                    </form>{" "}
                    <form class="inline" method="post" action={`/admin/selections/items/${it.id}/reorder`}>
                      <input type="hidden" name="dir" value="1" />
                      <button class="iconbtn" type="submit" disabled={i === items.length - 1}>
                        ↓
                      </button>
                    </form>{" "}
                    <form class="inline" method="post" action={`/admin/selections/items/${it.id}/remove`}>
                      <button class="btn btn--danger btn--sm" type="submit">
                        Odebrat
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colspan={3} class="empty">
                    Zatím žádné pořady. Najdi pořad níže a přidej ho.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div class="card" id="add">
            <h2 style="border:none;margin-bottom:8px">Přidat pořad</h2>
            {/* No-JS fallback: GET search reloads with results; the island enhances it. */}
            <form method="get" action={`/admin/selections/${sel!.id}`} id="sel-searchform">
              <div class="row">
                <input type="text" name="q" id="sel-search" value={q ?? ""} placeholder="Najít pořad…" autocomplete="off" />
                <button class="btn btn--ghost" type="submit">
                  Hledat
                </button>
              </div>
            </form>
            <div id="sel-results">
              {pickShow && parts ? (
                <div class="card" style="margin-top:12px">
                  <strong>{pickShow.title}</strong>
                  <form method="post" action={`/admin/selections/${sel!.id}/items`} style="margin-top:8px">
                    <input type="hidden" name="showId" value={String(pickShow.id)} />
                    <div class="row">
                      <select name="partId">
                        <option value="">Celý pořad</option>
                        {parts.map((p) => (
                          <option value={String(p.id)}>{dilLabel(p.idx, p.title)}</option>
                        ))}
                      </select>
                      <button class="btn" type="submit">
                        Přidat
                      </button>
                    </div>
                  </form>
                </div>
              ) : results ? (
                <ul class="results">
                  {results.map((r) => (
                    <li>
                      <span class="t">
                        {r.title}
                        {r.showName ? <span class="muted"> · {r.showName}</span> : null}
                      </span>
                      <span style="white-space:nowrap">
                        <form class="inline" method="post" action={`/admin/selections/${sel!.id}/items`}>
                          <input type="hidden" name="showId" value={String(r.id)} />
                          <button class="btn btn--sm" type="submit">
                            + celý
                          </button>
                        </form>{" "}
                        <a class="btn btn--ghost btn--sm" href={`/admin/selections/${sel!.id}?showId=${r.id}#add`}>
                          díly…
                        </a>
                      </span>
                    </li>
                  ))}
                  {results.length === 0 ? <li class="empty">Nic nenalezeno.</li> : null}
                </ul>
              ) : null}
            </div>
            <p class="hint">Tip: „+ celý“ přidá celý pořad; „díly…“ umožní vybrat konkrétní díl.</p>
          </div>
          <script dangerouslySetInnerHTML={{ __html: islandJs(sel!.id) }} />
        </>
      )}
    </Layout>
  );
}

function PreviewPage({ sel, items, thumb }: { sel: SelRow; items: Items; thumb: string | null }) {
  return (
    <Layout title={`Náhled — ${sel.title}`}>
      <p class="muted">
        <a href={`/admin/selections/${sel.id}`}>← Zpět na úpravy</a> · {sel.published ? "publikováno" : "koncept (zatím neveřejné)"}
      </p>
      {thumb ? <img class="thumb" style="width:280px;height:175px" src={thumb} alt="" /> : null}
      <h2 style="margin-top:14px">{sel.title}</h2>
      {sel.description ? <p>{sel.description}</p> : null}
      <ul class="results" style="max-height:none">
        {items.map((it) => (
          <li>
            <span class="t">
              {it.title}
              {it.showName ? <span class="muted"> · {it.showName}</span> : null}
            </span>
            <span class="badge">{it.partIdx == null ? "celý pořad" : dilLabel(it.partIdx, it.partTitle)}</span>
          </li>
        ))}
        {items.length === 0 ? <li class="empty">Zatím žádné pořady.</li> : null}
      </ul>
    </Layout>
  );
}

/** Tiny no-framework enhancement: live search + inline díl picker, no page reloads. */
function islandJs(selId: number): string {
  return `
(function(){
  var sel=${selId};
  var input=document.getElementById('sel-search');
  var out=document.getElementById('sel-results');
  var form=document.getElementById('sel-searchform');
  if(!input||!out||!form)return;
  form.addEventListener('submit',function(e){e.preventDefault();run();});
  var t;
  input.addEventListener('input',function(){clearTimeout(t);t=setTimeout(run,250);});
  function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function run(){
    var q=input.value.trim();
    if(!q){out.innerHTML='';return;}
    fetch('/admin/selections/_search?q='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(rows){
      if(!rows.length){out.innerHTML='<ul class="results"><li class="empty">Nic nenalezeno.</li></ul>';return;}
      out.innerHTML='<ul class="results">'+rows.map(function(r){
        return '<li data-show="'+r.id+'" data-title="'+esc(r.title)+'"><span class="t">'+esc(r.title)+(r.showName?' <span class=muted>· '+esc(r.showName)+'</span>':'')+'</span>'+
          '<span style="white-space:nowrap"><button class="btn btn--sm js-whole">+ celý</button> <button class="btn btn--ghost btn--sm js-parts">díly…</button></span></li>';
      }).join('')+'</ul>';
    });
  }
  out.addEventListener('click',function(e){
    var li=e.target.closest('li[data-show]'); if(!li)return;
    var showId=li.getAttribute('data-show');
    if(e.target.classList.contains('js-whole')){e.preventDefault();post(showId,'');}
    else if(e.target.classList.contains('js-parts')){e.preventDefault();loadParts(showId,li.getAttribute('data-title'));}
  });
  function loadParts(showId,title){
    fetch('/admin/selections/_parts?showId='+encodeURIComponent(showId)).then(function(r){return r.json();}).then(function(parts){
      var opts='<option value="">Celý pořad</option>'+parts.map(function(p){return '<option value="'+p.id+'">'+esc(p.idx+'. díl'+(p.title?(' — '+p.title):''))+'</option>';}).join('');
      out.innerHTML='<div class="card" style="margin-top:12px"><strong>'+esc(title)+'</strong><div class="row" style="margin-top:8px"><select id="js-part">'+opts+'</select><button class="btn js-add">Přidat</button> <button class="btn btn--ghost js-back">Zpět</button></div></div>';
      out.querySelector('.js-add').addEventListener('click',function(){post(showId, out.querySelector('#js-part').value);});
      out.querySelector('.js-back').addEventListener('click',run);
    });
  }
  function post(showId,partId){
    var f=document.createElement('form');f.method='post';f.action='/admin/selections/'+sel+'/items';
    f.innerHTML='<input name="showId" value="'+showId+'"><input name="partId" value="'+partId+'">';
    document.body.appendChild(f);f.submit();
  }
})();
`;
}

// ---- routes ----

function parseSel(body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const published = body.published === "1" || body.published === "on";
  return { title, description, published };
}

const MAX_THUMB_BYTES = 8 * 1024 * 1024; // refuse oversized admin uploads

/**
 * Apply the thumbnail choice from a submitted form to a selection. Precedence
 * (most explicit wins): "remove" → uploaded file (resize + pin to IPFS) → external
 * URL → unchanged. cid and url are mutually exclusive so the chosen source shows.
 */
async function applyThumbnail(
  id: number,
  body: Record<string, unknown>,
  current: { thumbnailUrl: string | null; thumbnailCid: string | null },
): Promise<string | null> {
  if (body.removeThumbnail === "1" || body.removeThumbnail === "on") {
    await adminSetSelectionThumbnail(id, { cid: null, url: null });
    return null;
  }
  const file = body.thumbnailFile;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_THUMB_BYTES) return "Obrázek je příliš velký (max 8 MB).";
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const thumb = await thumbnailFromBuffer(buf, `sel-${id}`);
      try {
        const { cid } = await ipfs.addFile(thumb.path);
        await adminSetSelectionThumbnail(id, { cid, url: null }); // pinned upload wins
      } finally {
        await discardTemp(thumb.path);
      }
    } catch (err) {
      log.error("thumbnail upload failed", { id, err: String(err) });
      return "Nahrání náhledu selhalo.";
    }
    return null;
  }
  // No file/remove: treat the URL field. Only write when it changed, and clear any
  // pinned cid so the URL actually takes effect (cid would otherwise win).
  const url =
    typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim() ? body.thumbnailUrl.trim() : null;
  if (url !== current.thumbnailUrl || (url && current.thumbnailCid)) {
    await adminSetSelectionThumbnail(id, { cid: null, url });
  }
  return null;
}

export const adminSelections = new Hono();

// CSRF: reject cross-origin state changes (Lax cookies aren't enough for destructive POSTs).
adminSelections.use("*", async (c, next) => {
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

adminSelections.get("/", async (c) => {
  const flash = c.req.query("flash");
  return c.html(doc(<ListPage rows={await adminListSelections()} flash={flash} />));
});

adminSelections.get("/new", (c) =>
  c.html(doc(<EditPage sel={null} items={[]} thumb={null} />)),
);

adminSelections.post("/", async (c) => {
  const body = await c.req.parseBody();
  const data = parseSel(body);
  if (!data.title) return back(c, "/admin/selections/new");
  const id = await adminCreateSelection({ ...data, published: false }); // can't publish an empty selection
  const err = await applyThumbnail(id, body, { thumbnailUrl: null, thumbnailCid: null });
  return back(c, err ? `/admin/selections/${id}?flash=${encodeURIComponent(err)}` : `/admin/selections/${id}`);
});

// JSON: live show search for the picker island.
adminSelections.get("/_search", async (c) => c.json(await adminSearchShows(c.req.query("q") ?? "")));
// JSON: a show's díly for the picker island.
adminSelections.get("/_parts", async (c) => {
  const showId = Number(c.req.query("showId"));
  return c.json(Number.isFinite(showId) ? await adminShowParts(showId) : []);
});

async function renderEdit(c: Context, id: number, flash?: string) {
  const sel = await adminGetSelection(id);
  if (!sel) return c.redirect("/admin/selections", 302);
  const items = await adminGetSelectionItems(id);
  // resolve a preview thumbnail: pinned upload (cid via gateway) → own url → none
  const thumb = streamUrl(sel.thumbnailCid) ?? sel.thumbnailUrl ?? null;
  const q = c.req.query("q");
  const showIdParam = c.req.query("showId");
  let results: Awaited<ReturnType<typeof adminSearchShows>> | undefined;
  let parts: Awaited<ReturnType<typeof adminShowParts>> | undefined;
  let pickShow: { id: number; title: string } | null = null;
  if (showIdParam) {
    const sid = Number(showIdParam);
    if (Number.isFinite(sid)) {
      parts = await adminShowParts(sid);
      const found = (await adminSearchShows(q ?? "")).find((r) => r.id === sid);
      pickShow = { id: sid, title: found?.title ?? `#${sid}` };
    }
  } else if (q != null) {
    results = await adminSearchShows(q);
  }
  return c.html(doc(<EditPage sel={sel} items={items} thumb={thumb} flash={flash} q={q} results={results} parts={parts} pickShow={pickShow} />));
}

adminSelections.get("/:id", async (c) => renderEdit(c, Number(c.req.param("id")), c.req.query("flash")));

adminSelections.get("/:id/preview", async (c) => {
  const id = Number(c.req.param("id"));
  const sel = await adminGetSelection(id);
  if (!sel) return back(c, "/admin/selections");
  const items = await adminGetSelectionItems(id);
  return c.html(doc(<PreviewPage sel={sel} items={items} thumb={streamUrl(sel.thumbnailCid) ?? sel.thumbnailUrl ?? null} />));
});

adminSelections.post("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.parseBody();
  const data = parseSel(body);
  if (!data.title) return back(c, `/admin/selections/${id}`);
  const sel = await adminGetSelection(id);
  if (!sel) return back(c, "/admin/selections");
  const items = await adminGetSelectionItems(id);
  if (data.published && items.length === 0) {
    return back(c, `/admin/selections/${id}?flash=${encodeURIComponent("Přidej alespoň jeden pořad, než výběr publikuješ.")}`);
  }
  await adminUpdateSelection(id, data);
  const err = await applyThumbnail(id, body, { thumbnailUrl: sel.thumbnailUrl, thumbnailCid: sel.thumbnailCid });
  return back(c, err ? `/admin/selections/${id}?flash=${encodeURIComponent(err)}` : `/admin/selections/${id}`);
});

adminSelections.post("/:id/delete", async (c) => {
  await adminDeleteSelection(Number(c.req.param("id")));
  return back(c, "/admin/selections");
});

adminSelections.post("/:id/reorder", async (c) => {
  const id = Number(c.req.param("id"));
  const dir = (await c.req.parseBody()).dir === "1" ? 1 : -1;
  await adminReorderSelection(id, dir);
  return back(c, `/admin/selections#sel-${id}`);
});

adminSelections.post("/:id/items", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.parseBody();
  const showId = Number(body.showId);
  const partId = body.partId && String(body.partId).trim() ? Number(body.partId) : null;
  if (!Number.isFinite(showId)) return back(c, `/admin/selections/${id}#add`);
  let flash = "";
  try {
    const ok = await adminAddItem(id, showId, partId);
    if (!ok) flash = `?flash=${encodeURIComponent("Tento díl už ve výběru je.")}`;
  } catch {
    flash = `?flash=${encodeURIComponent("Pořad se nepodařilo přidat.")}`; // e.g. invalid show/díl
  }
  return back(c, `/admin/selections/${id}${flash}#items`);
});

adminSelections.post("/items/:itemId/remove", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  const selId = await getItemSelectionId(itemId); // resolve before delete
  await adminRemoveItem(itemId);
  return back(c, selId ? `/admin/selections/${selId}#items` : "/admin/selections");
});

adminSelections.post("/items/:itemId/reorder", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  const dir = (await c.req.parseBody()).dir === "1" ? 1 : -1;
  const selId = await getItemSelectionId(itemId);
  await adminReorderItem(itemId, dir);
  return back(c, selId ? `/admin/selections/${selId}#item-${itemId}` : "/admin/selections");
});

// small helper: find an item's selection for the redirect (before delete cascades it)
import { db, schema } from "@rozhlas/core";
import { eq } from "drizzle-orm";
async function getItemSelectionId(itemId: number): Promise<number | null> {
  const [r] = await db
    .select({ sid: schema.selectionItems.selectionId })
    .from(schema.selectionItems)
    .where(eq(schema.selectionItems.id, itemId))
    .limit(1);
  return r?.sid ?? null;
}
