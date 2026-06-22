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
  // voyage-4-lite: cheapest model with a free tier (200M free tokens, then
  // $0.02/M). Avoid legacy voyage-3.x — those get zero free tokens.
  VOYAGE_MODEL: z.string().default("voyage-4-lite"),
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(1024),
  // Omnisearch intent parsing: "heuristic" (no LLM — default), "claude" (API),
  // or "ollama" (local). Default is heuristic: small local models mangle Czech
  // (invent non-words, drop diacritics → 0 FTS hits), and Voyage's multilingual
  // embeddings carry the semantic search anyway — see omnisearch.ts. Falls back
  // to heuristic on any provider error.
  INTENT_PROVIDER: z.enum(["heuristic", "ollama", "claude"]).default("heuristic"),
  // Local Ollama (intent provider "ollama").
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:3b"),
  // Claude (intent provider "claude"). Haiku is plenty for short query rewriting
  // and the cheapest/fastest tier (~$0.0005/query); set ANTHROPIC_API_KEY to use.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),

  // --- Transcription (faster-whisper via a Python subprocess) ---
  // Path to a Python that has faster-whisper installed (e.g. a venv). If unset,
  // the transcribe stage is disabled (jobs no-op) so the rest of the pipeline runs.
  WHISPER_PYTHON: z.string().optional(),
  WHISPER_MODEL: z.string().default("large-v3"),
  // Drain ALL pinned audio without a transcript on boot (the historical backfill).
  // Off by default: on this CPU that's ~year of grinding — meant for a GPU/Groq
  // batch. Steady-state (new shows) is queued from ipfs-verify regardless.
  TRANSCRIBE_BACKFILL: z.coerce.boolean().default(false),
  // CPU threads for whisper. Kept below nproc by default so transcription doesn't
  // starve the scraper/worker/IPFS on the shared box.
  WHISPER_THREADS: z.coerce.number().int().positive().default(4),
  // Target characters per embedded/indexed transcript chunk (~350-400 tokens).
  TRANSCRIPT_CHUNK_CHARS: z.coerce.number().int().positive().default(1500),

  // --- Groq free-tier backfill (newest-first; see docs/plans/groq-free-backfill.md) ---
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_STT_MODEL: z.string().default("whisper-large-v3"),
  // Master switch for the paced backfill consumer.
  GROQ_BACKFILL_ENABLED: z.coerce.boolean().default(false),
  // Self-pacing ceiling, kept under Groq free's 7,200 audio-sec/hour.
  GROQ_AUDIO_SECONDS_PER_HOUR: z.coerce.number().int().positive().default(7000),
  // Transcode each file to 16 kHz mono and skip if still above this (free upload cap is 25 MB).
  GROQ_MAX_UPLOAD_MB: z.coerce.number().positive().default(24),
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
