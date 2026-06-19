import { config, isProd } from "./config.ts";

type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const LEVELS: Record<Level, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

const threshold = LEVELS[config.LOG_LEVEL];

/**
 * Tiny structured logger — zero deps, Bun-native. JSON in prod (machine-readable
 * for log shippers), pretty single-line in dev. Swap for pino later if needed.
 */
function emit(level: Level, scope: string, msg: string, fields?: object) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString();
  if (isProd) {
    process.stdout.write(
      JSON.stringify({ time, level, scope, msg, ...fields }) + "\n",
    );
  } else {
    const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
    process.stdout.write(`${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${extra}\n`);
  }
}

export interface Logger {
  fatal(msg: string, fields?: object): void;
  error(msg: string, fields?: object): void;
  warn(msg: string, fields?: object): void;
  info(msg: string, fields?: object): void;
  debug(msg: string, fields?: object): void;
  trace(msg: string, fields?: object): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    fatal: (m, f) => emit("fatal", scope, m, f),
    error: (m, f) => emit("error", scope, m, f),
    warn: (m, f) => emit("warn", scope, m, f),
    info: (m, f) => emit("info", scope, m, f),
    debug: (m, f) => emit("debug", scope, m, f),
    trace: (m, f) => emit("trace", scope, m, f),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger("rozhlas");
