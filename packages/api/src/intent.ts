import { config, createLogger } from "@rozhlas/core";

const log = createLogger("api:intent");

export type IntentProvider = "heuristic" | "ollama" | "claude";

export interface Intent {
  searchText: string; // clean phrase for semantic + FTS search
  themes: string[];
  provider: IntentProvider;
}

// Czech filler words to drop in the heuristic fallback.
const STOP = new Set([
  "a", "i", "na", "se", "je", "do", "to", "co", "si", "mi", "me", "ale", "nebo",
  "jsem", "chci", "potrebuji", "potřebuji", "nejak", "nějaké", "nejaké", "neco",
  "něco", "prosim", "prosím", "bych", "rad", "rád", "rada", "ráda", "abych",
  "kdyz", "když", "jak", "tak", "ten", "ta", "po", "za", "ve", "v", "s", "k",
]);

const SYSTEM_CS =
  "Jsi vyhledávací asistent pro archiv české rozhlasové četby (čtení, povídky, " +
  "rozhlasové hry, audioknihy). Z přirozeného dotazu uživatele (nálada, situace, " +
  "téma) vytvoř krátkou českou vyhledávací frázi. `searchText` musí být 3–8 " +
  "českých klíčových slov oddělených MEZERAMI (žádná podtržítka, žádný přepis do " +
  "jiné abecedy). `themes` je seznam 1–4 témat. Odpověz pouze JSON ve tvaru " +
  '{"searchText": string, "themes": string[]}.';

/** Clean up small-model artifacts (underscores, runaway whitespace). */
function sanitize(s: string): string {
  return s.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

const SCHEMA = {
  type: "object",
  properties: {
    searchText: { type: "string" },
    themes: { type: "array", items: { type: "string" } },
  },
  required: ["searchText", "themes"],
  additionalProperties: false,
} as const;

/** Parse a natural-language request into a search phrase, per configured provider. */
export async function parseIntent(query: string): Promise<Intent> {
  const provider = config.INTENT_PROVIDER;
  try {
    if (provider === "ollama") return await ollamaIntent(query);
    if (provider === "claude" && config.ANTHROPIC_API_KEY) return await claudeIntent(query);
  } catch (err) {
    log.warn(`intent provider "${provider}" failed; using heuristic`, { err: String(err) });
  }
  return heuristic(query);
}

function heuristic(q: string): Intent {
  const words = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return { searchText: words.join(" ") || q, themes: [], provider: "heuristic" };
}

/** Local Ollama (CPU, no API cost) via /api/chat with JSON-schema structured output. */
async function ollamaIntent(q: string): Promise<Intent> {
  const res = await fetch(`${config.OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.OLLAMA_MODEL,
      stream: false,
      format: SCHEMA,
      keep_alive: "1h", // keep the model resident so searches stay warm
      options: { temperature: 0.2, num_predict: 256 },
      messages: [
        { role: "system", content: SYSTEM_CS },
        { role: "user", content: q },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const json = (await res.json()) as { message?: { content?: string } };
  const parsed = JSON.parse(json.message?.content ?? "{}") as {
    searchText?: string;
    themes?: string[];
  };
  const searchText = sanitize(parsed.searchText ?? "");
  return {
    searchText: searchText || q,
    themes: (parsed.themes ?? []).map(sanitize).filter(Boolean),
    provider: "ollama",
  };
}

/** Claude via the Messages API (paid). */
async function claudeIntent(q: string): Promise<Intent> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 400,
      system: SYSTEM_CS,
      messages: [{ role: "user", content: q }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text) as { searchText?: string; themes?: string[] };
  return {
    searchText: sanitize(parsed.searchText ?? "") || q,
    themes: parsed.themes ?? [],
    provider: "claude",
  };
}
