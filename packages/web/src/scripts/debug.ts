// Gated on-device player diagnostic. Enable by opening any page with `?debug=1`
// (persists in localStorage under `rozhlas:debug`; `?debug=0` turns it off). It
// records the media-event + play()-promise + visibility/readyState/networkState
// trace of the shell <audio> so a *real device* can capture what happens during a
// mobile background auto-advance — where local (desktop, headless) repro is
// impossible. Every event is persisted to localStorage immediately, so a
// background freeze/kill can't lose the trace: reopen the app, read the panel.
// Zero cost unless explicitly enabled.

const KEY = "rozhlas:debug";
const LOG_KEY = "rozhlas:debug:log";
const MAX = 400;

function enabled(): boolean {
  try {
    const u = new URLSearchParams(location.search);
    if (u.get("debug") === "1") localStorage.setItem(KEY, "1");
    if (u.get("debug") === "0") localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const buf: string[] = [];
let panelBody: HTMLElement | null = null;

function snap(a: HTMLAudioElement): string {
  let end = "-";
  try {
    const b = a.buffered;
    if (b.length) end = b.end(b.length - 1).toFixed(1);
  } catch {
    /* buffered can throw if not ready */
  }
  const vis = document.visibilityState[0]; // v(isible) / h(idden)
  return `vis=${vis} rs=${a.readyState} ns=${a.networkState} pause=${a.paused ? 1 : 0} ct=${a.currentTime.toFixed(1)} buf=${end}`;
}

function persist(): void {
  try {
    localStorage.setItem(LOG_KEY, buf.join("\n"));
  } catch {
    /* quota — ignore */
  }
}

function rec(line: string): void {
  buf.push(line);
  if (buf.length > MAX) buf.shift();
  persist();
  if (panelBody) {
    panelBody.textContent = buf.join("\n");
    panelBody.scrollTop = panelBody.scrollHeight;
  }
}

function buildPanel(): void {
  const wrap = document.createElement("div");
  wrap.id = "player-debug";
  wrap.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(0,0,0,.88);color:#0f0;" +
    "font:10px/1.35 monospace;border-bottom:2px solid #0f0;max-height:42vh;display:flex;flex-direction:column;";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:6px;padding:4px 6px;align-items:center;flex:0 0 auto;";
  const label = document.createElement("strong");
  label.textContent = "PLAYER DEBUG";
  label.style.color = "#0f0";
  const mk = (t: string, on: () => void) => {
    const b = document.createElement("button");
    b.textContent = t;
    b.style.cssText = "font:10px monospace;background:#0f0;color:#000;border:0;padding:2px 6px;cursor:pointer;";
    b.addEventListener("click", on);
    return b;
  };
  const body = document.createElement("pre");
  body.style.cssText = "margin:0;padding:4px 6px;overflow:auto;white-space:pre-wrap;flex:1 1 auto;";
  panelBody = body;
  bar.append(
    label,
    mk("COPY", async () => {
      const txt = buf.join("\n");
      try {
        await navigator.clipboard.writeText(txt);
        label.textContent = "COPIED ✓";
      } catch {
        // fallback: select the text so the user can long-press → copy
        const r = document.createRange();
        r.selectNodeContents(body);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
        label.textContent = "SELECTED — long-press copy";
      }
      setTimeout(() => (label.textContent = "PLAYER DEBUG"), 2500);
    }),
    mk("CLEAR", () => {
      buf.length = 0;
      persist();
      body.textContent = "";
    }),
    mk("OFF", () => {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      wrap.remove();
    }),
  );
  wrap.append(bar, body);
  document.body.appendChild(wrap);
  body.textContent = buf.join("\n");
  body.scrollTop = body.scrollHeight;
}

/** Attach the diagnostic to the shell <audio>. No-op unless `?debug=1` was set. */
export function initPlayerDebug(audio: HTMLAudioElement): void {
  if (!enabled()) return;
  const t0 = Date.now();
  try {
    buf.push(...(localStorage.getItem(LOG_KEY) || "").split("\n").filter(Boolean));
    buf.push("──── session start ────");
  } catch {
    /* ignore */
  }
  const at = () => String(Date.now() - t0).padStart(6, " ");
  const log = (ev: string, extra = "") => rec(`${at()} ${ev.padEnd(13)} ${snap(audio)}${extra ? " " + extra : ""}`);

  const EVENTS = [
    "loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough",
    "play", "playing", "pause", "waiting", "stalled", "suspend", "abort",
    "emptied", "ended", "error", "seeking", "seeked", "ratechange",
  ];
  for (const ev of EVENTS) {
    audio.addEventListener(ev, () => {
      let extra = "";
      if (ev === "error") extra = `code=${audio.error?.code} ${audio.error?.message ?? ""}`;
      if (ev === "loadstart") extra = "src…" + (audio.currentSrc || audio.src).slice(-32);
      log(ev, extra);
    });
  }

  // Wrap play() to capture the promise outcome (resolve vs reject reason) — the
  // single most important datum for the auto-advance failure.
  const origPlay = audio.play.bind(audio);
  audio.play = function () {
    const p = origPlay();
    log("play()·call");
    p.then(() => log("play()·RESOLVE")).catch((e) => log("play()·REJECT", `${e.name}: ${String(e.message || "").slice(0, 48)}`));
    return p;
  };

  document.addEventListener("visibilitychange", () => log("visibilitychange", document.visibilityState));

  buildPanel();
  log("debug attached");
}
