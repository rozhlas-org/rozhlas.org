import { basename } from "node:path";
import { config, createLogger } from "@rozhlas/core";

const log = createLogger("ipfs");

export interface AddResult {
  cid: string;
  size: number;
}

export interface VerifyResult {
  streamable: boolean;
  status: number;
  contentType: string | null;
  contentLength: number | null;
}

/** Thin client over the Kubo RPC API (`/api/v0`) + HTTP gateway. */
export class IpfsClient {
  constructor(
    private readonly apiUrl: string,
    private readonly gatewayUrl: string,
  ) {}

  /** Add a local file, pin it, and return its CIDv1. Caller deletes the temp file after. */
  async addFile(path: string): Promise<AddResult> {
    const form = new FormData();
    form.append("file", Bun.file(path), basename(path));

    const url = `${this.apiUrl}/api/v0/add?cid-version=1&pin=true&quieter=true`;
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      throw new Error(`ipfs add failed: ${res.status} ${await res.text()}`);
    }
    // Kubo streams NDJSON; the final line is the root object.
    const text = (await res.text()).trim();
    const lines = text.split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]!) as {
      Hash: string;
      Size: string;
    };
    log.debug("added", { cid: last.Hash, size: last.Size });
    return { cid: last.Hash, size: Number(last.Size) };
  }

  /** Public gateway URL for streaming a CID. */
  gatewayFor(cid: string): string {
    return `${this.gatewayUrl}/ipfs/${cid}`;
  }

  /**
   * Confirm the CID is streamable through the gateway via a 1-byte range request
   * (cheap; proves range support, which players need for seeking).
   */
  async verifyStreamable(cid: string): Promise<VerifyResult> {
    const res = await fetch(this.gatewayFor(cid), {
      headers: { Range: "bytes=0-0" },
    });
    const streamable = res.status === 206 || res.status === 200;
    const totalFromRange = res.headers
      .get("content-range")
      ?.split("/")
      .pop();
    const contentLength = totalFromRange
      ? Number(totalFromRange)
      : res.headers.get("content-length")
        ? Number(res.headers.get("content-length"))
        : null;
    await res.body?.cancel();
    return {
      streamable,
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: Number.isNaN(contentLength as number) ? null : contentLength,
    };
  }
}

/** Default client built from env config. */
export const ipfs = new IpfsClient(config.IPFS_API_URL, config.IPFS_GATEWAY_URL);
