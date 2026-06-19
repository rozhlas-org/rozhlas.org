import { config } from "@rozhlas/core";

export interface Intent {
  searchText: string; // clean phrase for semantic + FTS search
  themes: string[];
  usedClaude: boolean;
}

// Czech filler words to drop in the heuristic fallback.
const STOP = new Set([
  "a", "i", "na", "se", "je", "do", "to", "co", "si", "mi", "me", "ale", "nebo",
  "jsem", "chci", "potrebuji", "potřebuji", "nejak", "nějaké", "nejaké", "neco",
  "něco", "prosim", "prosím", "bych", "rad", "rád", "rada", "ráda", "abych",
  "kdyz", "když", "jak", "tak", "ten", "ta", "to", "po", "za", "ve", "v", "s", "k",
]);

/** Turn a natural-language request into a search phrase. Uses Claude when keyed. */
export async function parseIntent(query: string): Promise<Intent> {
  if (config.ANTHROPIC_API_KEY) {
    try {
      return await claudeIntent(query);
    } catch {
      // fall through to heuristic
    }
  }
  return heuristic(query);
}

function heuristic(q: string): Intent {
  const words = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return { searchText: words.join(" ") || q, themes: [], usedClaude: false };
}

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
      system:
        "Jsi vyhledávací asistent pro archiv české rozhlasové četby (čtení, povídky, " +
        "rozhlasové hry, audioknihy). Z přirozeného dotazu uživatele (např. nálada, " +
        "situace, téma) vytvoř krátkou českou vyhledávací frázi vhodnou pro sémantické " +
        "vyhledávání a seznam témat. Vrať pouze JSON.",
      messages: [{ role: "user", content: q }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              searchText: { type: "string" },
              themes: { type: "array", items: { type: "string" } },
            },
            required: ["searchText", "themes"],
            additionalProperties: false,
          },
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`claude intent ${res.status}`);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text) as { searchText?: string; themes?: string[] };
  return {
    searchText: parsed.searchText?.trim() || q,
    themes: parsed.themes ?? [],
    usedClaude: true,
  };
}
