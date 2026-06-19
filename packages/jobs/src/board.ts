import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import type { Hono } from "hono";
import type { serveStatic as ServeStatic } from "hono/bun";
import { allQueues } from "./queues.ts";

/**
 * Mount the Bull Board dashboard onto a Hono app at `basePath`.
 * `serveStatic` is injected by the caller (hono/bun) to keep this package
 * runtime-agnostic.
 */
export function mountBullBoard(
  app: Hono,
  basePath: string,
  serveStatic: typeof ServeStatic,
) {
  const serverAdapter = new HonoAdapter(serveStatic);

  createBullBoard({
    queues: allQueues().map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  serverAdapter.setBasePath(basePath);
  app.route(basePath, serverAdapter.registerPlugin());
  return app;
}
