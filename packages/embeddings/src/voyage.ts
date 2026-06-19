import type { EmbeddingProvider, InputType } from "./types.ts";

/**
 * Voyage AI embeddings (https://api.voyageai.com/v1/embeddings). `input_type`
 * "query"/"document" lets Voyage apply task-specific prompting; `output_dimension`
 * selects the vector size (voyage-3.5 supports 256/512/1024/2048).
 */
export class VoyageProvider implements EmbeddingProvider {
  readonly id: string;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    readonly dims: number,
  ) {
    this.id = `voyage:${model}`;
  }

  async embed(texts: string[], inputType: InputType): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        input_type: inputType,
        output_dimension: this.dims,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`voyage embeddings failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => Float32Array.from(d.embedding));
  }
}
