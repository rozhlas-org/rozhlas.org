import { Hono, type Context } from "hono";
import {
  adminListCategoryGroups,
  adminGetCategoryGroup,
  adminGetGroupProgrammes,
  adminCreateCategoryGroup,
  adminUpdateCategoryGroup,
  adminDeleteCategoryGroup,
  adminReorderCategoryGroup,
  adminSetGroupProgrammes,
  adminSetCategoryGroupThumbnail,
  listProgrammes,
  streamUrl,
} from "../queries.ts";
import { ipfs } from "@rozhlas/ipfs";
import { thumbnailFromBuffer, discardTemp } from "@rozhlas/media";
import { createLogger } from "@rozhlas/core";

const log = createLogger("admin:category-groups");

// Admin CRUD for category groups (frontend "Kategorie" tiles). Server-rendered (Hono JSX),
// behind the /admin session guard, at /admin/category-groups. Mutations POST → redirect (PRG).
// A group = name/description/thumbnail + a checkbox set of programmes (shows.show_name).

const MAX_THUMB_BYTES = 8 * 1024 * 1024;

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
.warn{background:#fffbe6;border:2px solid var(--yellow);padding:8px 12px;margin:0 0 16px;font-size:13px}
table{width:100%;border-collapse:collapse;background:var(--paper);border:2px solid var(--ink);font-size:14px}
th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);background:#fafaf8}
.badge{font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;padding:2px 7px;border:1px solid var(--ink);display:inline-block}
.badge--ok{background:var(--cyan)} .badge--off{background:var(--line)}
.btn{font-family:Saira Condensed,system-ui,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.5px;font-size:13px;padding:7px 12px;background:var(--ink);color:#fff;border:2px solid var(--ink);box-shadow:3px 3px 0 var(--cyan);cursor:pointer;text-decoration:none;display:inline-block}
.btn:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--cyan)}
.btn--ghost{background:var(--paper);color:var(--ink);box-shadow:none}
.btn--danger{box-shadow:3px 3px 0 var(--magenta)}
.btn--sm{font-size:11px;padding:4px 8px;box-shadow:2px 2px 0 var(--cyan)}
.iconbtn{font-family:Space Mono,monospace;font-size:13px;padding:3px 8px;background:var(--paper);border:2px solid var(--ink);cursor:pointer}
.iconbtn:disabled{opacity:.3;cursor:default}
form.inline{display:inline}
label{display:block;font-family:Space Mono,monospace;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:14px 0 4px}
input[type=text],input[type=url],textarea{width:100%;padding:9px;border:2px solid var(--ink);font-size:15px;font-family:inherit;background:var(--paper)}
textarea{min-height:72px}
.check{display:flex;align-items:center;gap:8px;margin:16px 0}
.check input{width:auto}
.muted{color:var(--muted);font-size:12px}
.thumb{width:160px;height:100px;object-fit:cover;border:2px solid var(--ink);background:repeating-linear-gradient(45deg,#ecebe6,#ecebe6 10px,#e1e0da 10px,#e1e0da 20px)}
.card{background:var(--paper);border:2px solid var(--ink);padding:18px;margin-bottom:22px}
.empty{color:var(--muted);font-style:italic}
.hint{font-family:Space Mono,monospace;font-size:11px;color:var(--muted);margin-top:4px}
.picker{columns:2;column-gap:24px;margin-top:8px}
@media(max-width:680px){.picker{columns:1}}
.picker label{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-family:inherit;font-size:14px;text-transform:none;letter-spacing:0;color:var(--ink);break-inside:avoid}
.picker label input{width:auto}
.picker .n{color:var(--muted);font-size:12px}
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
            rozhlas<span class="accent">.org</span> · Kategorie
          </h1>
          <nav>
            <a href="/admin">Přehled</a>
            <a href="/admin/selections">Výběry</a>
            <a href="/admin/recommendations">Doporučení</a>
            <a href="/admin/category-groups">Kategorie</a>
            <a href="/admin/jobs">Fronty</a>
            <a class="logout" href="/admin/logout">Odhlásit</a>
          </nav>
        </header>
        <main>{children as never}</main>
      </body>
    </html>
  );
}

const doc = (node: unknown): string => "<!doctype html>" + (node as { toString(): string }).toString();

// ---- pages ----

function ListPage({ rows, flash }: { rows: Awaited<ReturnType<typeof adminListCategoryGroups>>; flash?: string }) {
  return (
    <Layout title="Kategorie">
      <h2>Kategorie</h2>
      {flash ? <p class="flash">{flash}</p> : null}
      <p>
        <a class="btn" href="/admin/category-groups/new">
          + Nová kategorie
        </a>
      </p>
      <table>
        <thead>
          <tr>
            <th>Název</th>
            <th>Pořadů</th>
            <th>Kategorií</th>
            <th>Stav</th>
            <th>Pořadí</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g, i) => (
            <tr id={`grp-${g.id}`}>
              <td>
                <a href={`/admin/category-groups/${g.id}`}>{g.title}</a>
                <div class="muted">/kategorie/{g.slug}</div>
                {g.published && g.showCount === 0 ? (
                  <div class="muted" style="color:var(--magenta)">⚠ Teď nemá žádné pořady — na webu se nezobrazí.</div>
                ) : null}
              </td>
              <td>{g.showCount}</td>
              <td>{g.programmeCount}</td>
              <td>{g.published ? <span class="badge badge--ok">publikováno</span> : <span class="badge badge--off">koncept</span>}</td>
              <td style="white-space:nowrap">
                <form class="inline" method="post" action={`/admin/category-groups/${g.id}/reorder`}>
                  <input type="hidden" name="dir" value="-1" />
                  <button class="iconbtn" type="submit" disabled={i === 0}>↑</button>
                </form>{" "}
                <form class="inline" method="post" action={`/admin/category-groups/${g.id}/reorder`}>
                  <input type="hidden" name="dir" value="1" />
                  <button class="iconbtn" type="submit" disabled={i === rows.length - 1}>↓</button>
                </form>
              </td>
              <td style="white-space:nowrap">
                <a class="btn btn--ghost btn--sm" href={`/admin/category-groups/${g.id}`}>Upravit</a>{" "}
                <form class="inline" method="post" action={`/admin/category-groups/${g.id}/delete`} onsubmit="return confirm('Smazat kategorii?')">
                  <button class="btn btn--danger btn--sm" type="submit">Smazat</button>
                </form>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colspan={6} class="empty">Zatím žádné kategorie.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Layout>
  );
}

type GroupRow = NonNullable<Awaited<ReturnType<typeof adminGetCategoryGroup>>>;
type Programmes = Awaited<ReturnType<typeof listProgrammes>>;

function EditPage({
  grp,
  thumb,
  programmes,
  selected,
  flash,
}: {
  grp: GroupRow;
  thumb: string | null;
  programmes: Programmes;
  selected: Set<string>;
  flash?: string;
}) {
  const canPublish = selected.size > 0;
  return (
    <Layout title={grp.title}>
      <p class="muted">
        <a href="/admin/category-groups">← Kategorie</a>
      </p>
      <h2>Upravit kategorii</h2>
      {flash ? <p class="flash">{flash}</p> : null}
      <div class="card">
        <form method="post" action={`/admin/category-groups/${grp.id}`} enctype="multipart/form-data">
          <label>Název</label>
          <input type="text" name="title" value={grp.title} required maxlength={120} />
          <label>Popis</label>
          <textarea name="description">{grp.description ?? ""}</textarea>

          <label>Náhledový obrázek (URL nebo nahrát)</label>
          <input type="url" name="thumbnailUrl" value={grp.thumbnailUrl ?? ""} placeholder="https://… (jinak se zobrazí šrafovaná výplň)" />
          <input type="file" name="thumbnailFile" accept="image/*" style="border:none;padding:8px 0" />
          {thumb ? (
            <div style="margin-top:10px">
              <img class="thumb" src={thumb} alt="" />
              <div class="hint">{grp.thumbnailCid ? "nahraný (IPFS)" : grp.thumbnailUrl ? "z URL" : ""}</div>
              <label class="check" style="margin-top:6px">
                <input type="checkbox" name="removeThumbnail" value="1" /> Odebrat obrázek
              </label>
            </div>
          ) : null}

          <label style="margin-top:18px">Pořady v kategorii</label>
          <input type="text" id="prog-filter" placeholder="Filtrovat pořady…" autocomplete="off" />
          <div class="picker" id="prog-picker">
            {programmes.map((p) => (
              <label data-name={(p.programme ?? "").toLowerCase()}>
                <input type="checkbox" name="programme" value={p.programme ?? ""} checked={selected.has(p.programme ?? "")} />
                <span>{p.programme}</span> <span class="n">({p.count})</span>
              </label>
            ))}
          </div>

          <div class="check">
            <input type="checkbox" id="published" name="published" value="1" checked={grp.published} disabled={!canPublish && !grp.published} />
            <label for="published" style="margin:0">Publikovat kategorii</label>
          </div>
          {selected.size === 0 ? <p class="hint">Vyber alespoň jeden pořad, než kategorii publikuješ.</p> : null}

          <p style="margin-top:16px">
            <button class="btn" type="submit">Uložit</button>{" "}
            <a class="btn btn--ghost" href={`/kategorie/${grp.slug}`} target="_blank" rel="noopener">Náhled na webu</a>
          </p>
        </form>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var f=document.getElementById('prog-filter'),p=document.getElementById('prog-picker');if(!f||!p)return;f.addEventListener('input',function(){var q=f.value.trim().toLowerCase();p.querySelectorAll('label[data-name]').forEach(function(l){l.style.display=(!q||l.getAttribute('data-name').indexOf(q)>=0)?'':'none';});});})();`,
        }}
      />
    </Layout>
  );
}

function NewPage({ flash }: { flash?: string }) {
  return (
    <Layout title="Nová kategorie">
      <p class="muted">
        <a href="/admin/category-groups">← Kategorie</a>
      </p>
      <h2>Nová kategorie</h2>
      {flash ? <p class="flash">{flash}</p> : null}
      <div class="card">
        <form method="post" action="/admin/category-groups">
          <label>Název</label>
          <input type="text" name="title" required maxlength={120} autofocus />
          <p class="hint">Pořady a obrázek přidáš po vytvoření.</p>
          <p style="margin-top:14px"><button class="btn" type="submit">Vytvořit</button></p>
        </form>
      </div>
    </Layout>
  );
}

// ---- thumbnail (mirror of the selections handler) ----
async function applyThumbnail(
  id: number,
  body: Record<string, unknown>,
  current: { thumbnailUrl: string | null; thumbnailCid: string | null },
): Promise<string | null> {
  if (body.removeThumbnail === "1" || body.removeThumbnail === "on") {
    await adminSetCategoryGroupThumbnail(id, { thumbnailCid: null, thumbnailUrl: null });
    return null;
  }
  const file = body.thumbnailFile;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_THUMB_BYTES) return "Obrázek je příliš velký (max 8 MB).";
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const thumb = await thumbnailFromBuffer(buf, `cg-${id}`);
      try {
        const { cid } = await ipfs.addFile(thumb.path);
        await adminSetCategoryGroupThumbnail(id, { thumbnailCid: cid, thumbnailUrl: null });
      } finally {
        await discardTemp(thumb.path);
      }
    } catch (err) {
      log.error("thumbnail upload failed", { id, err: String(err) });
      return "Nahrání náhledu selhalo.";
    }
    return null;
  }
  const url = typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim() ? body.thumbnailUrl.trim() : null;
  if (url !== current.thumbnailUrl || (url && current.thumbnailCid)) {
    await adminSetCategoryGroupThumbnail(id, { thumbnailCid: null, thumbnailUrl: url });
  }
  return null;
}

function checkedProgrammes(body: Record<string, unknown>): string[] {
  const v = body.programme;
  const arr = v == null ? [] : Array.isArray(v) ? v : [v];
  return arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

// ---- routes ----

export const adminCategoryGroups = new Hono();

adminCategoryGroups.use("*", async (c, next) => {
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

const back = (c: Context, url: string) => c.redirect(url, 302);

adminCategoryGroups.get("/", async (c) =>
  c.html(doc(<ListPage rows={await adminListCategoryGroups()} flash={c.req.query("flash")} />)),
);

adminCategoryGroups.get("/new", (c) => c.html(doc(<NewPage flash={c.req.query("flash")} />)));

adminCategoryGroups.post("/", async (c) => {
  const body = await c.req.parseBody();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return back(c, "/admin/category-groups/new");
  const id = await adminCreateCategoryGroup({ title, description: null, thumbnailUrl: null, published: false });
  return back(c, `/admin/category-groups/${id}`);
});

async function renderEdit(c: Context, id: number, flash?: string) {
  const grp = await adminGetCategoryGroup(id);
  if (!grp) return c.redirect("/admin/category-groups", 302);
  const programmes = await listProgrammes();
  const selected = new Set(await adminGetGroupProgrammes(id));
  const thumb = streamUrl(grp.thumbnailCid) ?? grp.thumbnailUrl ?? null;
  return c.html(doc(<EditPage grp={grp} thumb={thumb} programmes={programmes} selected={selected} flash={flash} />));
}

adminCategoryGroups.get("/:id", (c) => renderEdit(c, Number(c.req.param("id")), c.req.query("flash")));

adminCategoryGroups.post("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const grp = await adminGetCategoryGroup(id);
  if (!grp) return back(c, "/admin/category-groups");
  const body = await c.req.parseBody({ all: true });
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return back(c, `/admin/category-groups/${id}`);
  const programmes = checkedProgrammes(body);
  await adminSetGroupProgrammes(id, programmes);
  const wantPublished = body.published === "1" || body.published === "on";
  if (wantPublished && programmes.length === 0) {
    await adminUpdateCategoryGroup(id, { title, description: descOf(body), thumbnailUrl: grp.thumbnailUrl, published: false });
    const err = await applyThumbnail(id, body, { thumbnailUrl: grp.thumbnailUrl, thumbnailCid: grp.thumbnailCid });
    return back(c, `/admin/category-groups/${id}?flash=${encodeURIComponent(err ?? "Vyber alespoň jeden pořad, než kategorii publikuješ.")}`);
  }
  await adminUpdateCategoryGroup(id, { title, description: descOf(body), thumbnailUrl: grp.thumbnailUrl, published: wantPublished });
  const err = await applyThumbnail(id, body, { thumbnailUrl: grp.thumbnailUrl, thumbnailCid: grp.thumbnailCid });
  return back(c, err ? `/admin/category-groups/${id}?flash=${encodeURIComponent(err)}` : `/admin/category-groups/${id}`);
});

const descOf = (body: Record<string, unknown>): string | null =>
  typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

adminCategoryGroups.post("/:id/delete", async (c) => {
  await adminDeleteCategoryGroup(Number(c.req.param("id")));
  return back(c, "/admin/category-groups");
});

adminCategoryGroups.post("/:id/reorder", async (c) => {
  const id = Number(c.req.param("id"));
  const dir = (await c.req.parseBody()).dir === "1" ? 1 : -1;
  await adminReorderCategoryGroup(id, dir);
  return back(c, `/admin/category-groups#grp-${id}`);
});
