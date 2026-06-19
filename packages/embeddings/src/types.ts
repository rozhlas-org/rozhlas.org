export type InputType = "document" | "query";

/** An embedding model. `embed` returns one unit-length vector per input text. */
export interface EmbeddingProvider {
  /** Stable id incl. model, e.g. "voyage:voyage-3.5" or "local-hash:256". */
  id: string;
  dims: number;
  embed(texts: string[], inputType: InputType): Promise<Float32Array[]>;
}
