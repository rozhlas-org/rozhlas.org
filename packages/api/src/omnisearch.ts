import { sqlite, toFtsQuery } from "@rozhlas/core";
import { getProvider, vectorSearch } from "@rozhlas/embeddings";
import { showItemsByIds, type ShowListItem } from "./queries.ts";
import { parseIntent, type Intent } from "./intent.ts";

function ftsIds(text: string, limit = 100): number[] {
  const q = toFtsQuery(text);
  if (!q) return [];
  try {
    const rows = sqlite
      .prepare("SELECT rowid AS id FROM shows_fts WHERE shows_fts MATCH ? LIMIT ?")
      .all(q, limit) as { id: number }[];
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

export interface OmniResult {
  intent: Intent;
  items: ShowListItem[];
  vectorHits: number;
  ftsHits: number;
}

/**
 * Natural-language search: parse intent → semantic vector KNN + keyword FTS,
 * merged into one ranking. Vector closeness dominates; FTS adds a keyword boost
 * and keeps search working even before anything is embedded.
 */
export async function omnisearch(query: string, k = 24): Promise<OmniResult> {
  const intent = await parseIntent(query);
  const provider = getProvider();
  const knn = await vectorSearch(provider, intent.searchText, 60);
  const fIds = ftsIds(intent.searchText, 100);

  const scores = new Map<number, number>();
  for (const h of knn) {
    scores.set(h.showId, (scores.get(h.showId) ?? 0) + 1 / (1 + h.distance));
  }
  fIds.forEach((id, i) => {
    const rankBoost = 0.5 * (1 - i / Math.max(fIds.length, 1));
    scores.set(id, (scores.get(id) ?? 0) + 0.3 + rankBoost);
  });

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);

  const map = await showItemsByIds(ranked);
  const items = ranked.map((id) => map.get(id)).filter((x): x is ShowListItem => !!x);
  return { intent, items, vectorHits: knn.length, ftsHits: fIds.length };
}
