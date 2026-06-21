import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { sql } from "drizzle-orm";
import { config, createLogger, db } from "@rozhlas/core";
import { connection, mountBullBoard } from "@rozhlas/jobs";
import { apiRoutes } from "./routes/api.ts";
import { adminAuth, adminAuthRoutes } from "./admin-auth.ts";
import { adminDashboard } from "./admin/dashboard.tsx";
import { adminSelections } from "./admin/selections.tsx";

const log = createLogger("api");
const app = new Hono();

// CORS for the static frontend (GitHub Pages). Configured origins + any localhost.
const allowedOrigins = config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return undefined;
      if (allowedOrigins.includes(origin)) return origin;
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
      return undefined;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/healthz", async (c) => {
  const checks: Record<string, "ok" | "error"> = {};
  try {
    db.run(sql`select 1`);
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }
  try {
    checks.redis = (await connection.ping()) === "PONG" ? "ok" : "error";
  } catch {
    checks.redis = "error";
  }
  const healthy = Object.values(checks).every((v) => v === "ok");
  return c.json({ status: healthy ? "ok" : "degraded", checks }, healthy ? 200 : 503);
});

// Root → API info (this service is API + admin only; the public site is the
// Astro frontend on GitHub Pages at rozhlas.org).
app.get("/", (c) =>
  c.json({ service: "rozhlas.org API", api: "/api", admin: config.BULL_BOARD_PATH }),
);

// JSON API.
app.route("/api", apiRoutes);

// Admin, gated by a login+session. The guard runs for every /admin path (it
// whitelists the login/logout routes); then the operator dashboard at /admin,
// then the Bull Board at /admin/jobs.
app.use("/admin", adminAuth);
app.use("/admin/*", adminAuth);
app.route("/", adminAuthRoutes);
app.route("/admin/selections", adminSelections); // before the dashboard mount (more specific)
app.route("/admin", adminDashboard);
// Bull Board's SPA lives at the trailing-slash base (it emits <base href="/admin/jobs/">),
// but the Hono mount below only answers the no-slash path — so reloading or bookmarking
// the canonical /admin/jobs/ URL 404s. Redirect the trailing slash to the no-slash path
// the mount serves. (Registered before the mount so it matches first.)
app.get(`${config.BULL_BOARD_PATH}/`, (c) => c.redirect(config.BULL_BOARD_PATH));
mountBullBoard(app, config.BULL_BOARD_PATH, serveStatic);

log.info("api listening", { port: config.API_PORT, board: config.BULL_BOARD_PATH });

export default { port: config.API_PORT, fetch: app.fetch };
