import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { config, createLogger } from "@rozhlas/core";

// Session login+password gate in front of the Bull Board admin dashboard.
// A signed (HMAC-SHA256) cookie carries an expiry; no server-side session store
// is needed. Everything under /admin/* requires a valid session except the login
// route itself. If ADMIN_PASSWORD / SESSION_SECRET are unset, admin is locked.

const log = createLogger("admin-auth");

const COOKIE = "rozhlas_admin";
const LOGIN_PATH = "/admin/login";
const LOGOUT_PATH = "/admin/logout";
const TTL_MS = config.SESSION_TTL_HOURS * 3600 * 1000;

const enabled = Boolean(config.ADMIN_PASSWORD && config.SESSION_SECRET);
if (!enabled) {
  log.warn("admin auth disabled: set ADMIN_PASSWORD and SESSION_SECRET to enable /admin");
}

function sign(payload: string): string {
  return createHmac("sha256", config.SESSION_SECRET!).update(payload).digest("base64url");
}

function issueToken(): string {
  const payload = `${Date.now() + TTL_MS}.${randomBytes(8).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}

function tokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const exp = Number(payload.split(".")[0]);
  return Number.isFinite(exp) && exp > Date.now();
}

function passwordOk(input: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(config.ADMIN_PASSWORD!).digest();
  return timingSafeEqual(a, b);
}

const secureCookie = config.NODE_ENV === "production";

function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Admin — rozhlas.org</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fff;color:#111;display:grid;place-items:center;min-height:100vh;margin:0}
  form{border:3px solid #111;box-shadow:7px 7px 0 #00aeef;padding:28px;width:min(360px,90vw)}
  h1{font-weight:900;text-transform:uppercase;margin:0 0 18px;font-size:28px}
  input{width:100%;box-sizing:border-box;padding:11px;border:3px solid #111;font-size:16px;margin-bottom:14px}
  button{font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:12px 20px;background:#111;color:#fff;border:3px solid #111;box-shadow:4px 4px 0 #ec008c;cursor:pointer}
  .err{color:#ec008c;font-weight:700;margin:0 0 14px}
</style></head>
<body><form method="post" action="${LOGIN_PATH}">
  <h1>Admin</h1>
  ${error ? `<p class="err">${error}</p>` : ""}
  <input type="password" name="password" placeholder="Heslo" autofocus autocomplete="current-password" />
  <button type="submit">Přihlásit</button>
</form></body></html>`;
}

/** Guard middleware: protects /admin/* (except the login route). */
export const adminAuth: MiddlewareHandler = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === LOGIN_PATH || path === LOGOUT_PATH) return next();
  if (!enabled) return c.text("Admin disabled: ADMIN_PASSWORD/SESSION_SECRET not set", 503);
  if (tokenValid(getCookie(c, COOKIE))) return next();
  return c.redirect(LOGIN_PATH, 302);
};

/** Login/logout routes. Mount before the Bull Board so they aren't shadowed. */
export const adminAuthRoutes = new Hono();

adminAuthRoutes.get(LOGIN_PATH, (c) => {
  if (!enabled) return c.text("Admin disabled: ADMIN_PASSWORD/SESSION_SECRET not set", 503);
  if (tokenValid(getCookie(c, COOKIE))) return c.redirect(config.BULL_BOARD_PATH, 302);
  return c.html(loginPage());
});

adminAuthRoutes.post(LOGIN_PATH, async (c) => {
  if (!enabled) return c.text("Admin disabled", 503);
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !passwordOk(password)) {
    log.warn("failed admin login");
    return c.html(loginPage("Nesprávné heslo."), 401);
  }
  setCookie(c, COOKIE, issueToken(), {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "Lax",
    path: "/admin",
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return c.redirect(config.BULL_BOARD_PATH, 302);
});

adminAuthRoutes.get(LOGOUT_PATH, (c) => {
  deleteCookie(c, COOKIE, { path: "/admin" });
  return c.redirect(LOGIN_PATH, 302);
});
