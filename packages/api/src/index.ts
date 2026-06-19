import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { sql } from "drizzle-orm";
import { config, createLogger, db } from "@rozhlas/core";
import { connection, mountBullBoard } from "@rozhlas/jobs";

const log = createLogger("api");
const app = new Hono();

app.get("/", (c) =>
  c.json({
    service: "rozhlas.org api",
    docs: "/healthz, " + config.BULL_BOARD_PATH,
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
    const pong = await connection.ping();
    checks.redis = pong === "PONG" ? "ok" : "error";
  } catch {
    checks.redis = "error";
  }
  const healthy = Object.values(checks).every((v) => v === "ok");
  return c.json({ status: healthy ? "ok" : "degraded", checks }, healthy ? 200 : 503);
});

// Placeholder for the public JSON API (Phase 2).
app.get("/api", (c) => c.json({ message: "rozhlas.org API — coming in Phase 2" }));

// Admin: Bull Board job dashboard.
mountBullBoard(app, config.BULL_BOARD_PATH, serveStatic);

log.info("api listening", {
  port: config.API_PORT,
  board: config.BULL_BOARD_PATH,
});

export default {
  port: config.API_PORT,
  fetch: app.fetch,
};
