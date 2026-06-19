import { z } from "zod";

/**
 * Centralised, validated configuration. Reads from the process environment
 * (Bun auto-loads `.env`). Fails fast with a readable error if something is off.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_PATH: z.string().default("./data/rozhlas.db"),

  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  IPFS_API_URL: z.string().url().default("http://localhost:5001"),
  IPFS_GATEWAY_URL: z.string().url().default("http://localhost:8080"),

  BULL_BOARD_PATH: z.string().startsWith("/").default("/admin/jobs"),

  // --- Public web / CORS ---
  // Comma-separated list of browser origins allowed to call the JSON API
  // (the static frontend on GitHub Pages). Localhost is always allowed for dev.
  CORS_ORIGINS: z
    .string()
    .default("https://rozhlas.org,https://www.rozhlas.org"),

  // --- Admin auth (Bull Board) ---
  // Login+session gate in front of BULL_BOARD_PATH. If ADMIN_PASSWORD is unset
  // the admin area is locked entirely (returns 503) rather than left open.
  ADMIN_PASSWORD: z.string().optional(),
  // Secret used to sign the admin session cookie. Required for admin to work.
  SESSION_SECRET: z.string().optional(),
  // Admin session lifetime in hours.
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),

  // --- AI / embeddings (Phase 4) ---
  // If VOYAGE_API_KEY is unset, a deterministic local fallback embedder is used.
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default("voyage-3.5"),
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(1024),
  // Omnisearch intent parsing: "ollama" (local, no API cost), "claude" (API),
  // or "heuristic" (no LLM). Falls back to heuristic on any provider error.
  INTENT_PROVIDER: z.enum(["heuristic", "ollama", "claude"]).default("ollama"),
  // Local Ollama (intent provider "ollama").
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:3b"),
  // Claude (intent provider "claude").
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),
});

export type Config = z.infer<typeof EnvSchema>;

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config: Config = load();

export const isProd = config.NODE_ENV === "production";
