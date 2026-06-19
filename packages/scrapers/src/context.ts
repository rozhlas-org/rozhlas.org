import { createLogger, type Logger } from "@rozhlas/core";
import type { ScrapeCtx } from "./types.ts";

const USER_AGENT =
  "rozhlas-org-bot/0.1 (+https://github.com/rozhlas-org/rozhlas.org)";
const DEFAULT_TIMEOUT_MS = 30_000;

/** A fetch wrapper that sets a polite UA and a timeout. */
export function politeFetch(timeoutMs = DEFAULT_TIMEOUT_MS): typeof fetch {
  return ((input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    return fetch(input, {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });
  }) as typeof fetch;
}

export function createScrapeCtx(
  opts: {
    log?: Logger;
    limit?: number;
    options?: Record<string, unknown>;
  } = {},
): ScrapeCtx {
  return {
    fetch: politeFetch(),
    log: opts.log ?? createLogger("scrapers"),
    limit: opts.limit,
    options: opts.options,
  };
}
