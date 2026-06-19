import type { EmbeddingProvider, InputType } from "./types.ts";

const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(COMBINING, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic, **offline** fallback embedder: hashed bag-of-words into a fixed
 * vector, L2-normalized. Purely lexical (no real semantics) — it exists so the
 * vector pipeline is testable without a Voyage key. Swap in VoyageProvider for
 * real semantic search by setting VOYAGE_API_KEY.
 */
export class LocalProvider implements EmbeddingProvider {
  readonly id: string;
  constructor(readonly dims = 256) {
    this.id = `local-hash:${dims}`;
  }

  async embed(texts: string[], _t: InputType): Promise<Float32Array[]> {
    return texts.map((t) => this.vec(t));
  }

  private vec(text: string): Float32Array {
    const v = new Float32Array(this.dims);
    const toks = normalize(text);
    const bump = (idx: number, w: number) => {
      v[idx] = (v[idx] ?? 0) + w;
    };
    for (let i = 0; i < toks.length; i++) {
      bump(fnv1a(toks[i]!) % this.dims, 1);
      if (i > 0) bump(fnv1a(`${toks[i - 1]}_${toks[i]}`) % this.dims, 0.5); // bigram
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dims; i++) v[i] = (v[i] ?? 0) / norm;
    return v;
  }
}
