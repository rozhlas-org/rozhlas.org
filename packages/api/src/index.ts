import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { sql } from "drizzle-orm";
import { config, createLogger, db } from "@rozhlas/core";
import { connection, mountBullBoard } from "@rozhlas/jobs";
import { apiRoutes } from "./routes/api.ts";
import { pageRoutes } from "./routes/pages.tsx";
import { adminAuth, adminAuthRoutes } from "./admin-auth.ts";

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
    allowMethods: ["GET", "OPTIONS"],
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

// Base stylesheet (cwd-independent; design system replaces public/styles.css).
const STYLES_PATH = join(import.meta.dir, "public/styles.css");
app.get("/styles.css", () =>
  new Response(Bun.file(STYLES_PATH), {
    headers: { "content-type": "text/css; charset=utf-8" },
  }),
);

// JSON API.
app.route("/api", apiRoutes);

// Admin dashboard, gated by a login+session. Login routes first, then the guard
// on /admin/*, then the Bull Board itself.
app.route("/", adminAuthRoutes);
app.use("/admin/*", adminAuth);
mountBullBoard(app, config.BULL_BOARD_PATH, serveStatic);

// Public server-rendered site (mounted last; owns the remaining routes).
app.route("/", pageRoutes);

log.info("api listening", { port: config.API_PORT, board: config.BULL_BOARD_PATH });

export default { port: config.API_PORT, fetch: app.fetch };
