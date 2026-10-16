import { DurableObject } from "cloudflare:workers";
import { FikenScheduler, FikenTransportError, type FikenFailureKind, type FikenHttpRequest } from "@fiken-mcp/core";
import { FIKEN_API_BASE } from "./config.ts";
import { log } from "./log.ts";

export interface QueuedRequest extends FikenHttpRequest {
  /** The user's Fiken access token. Used for this request only, never stored. */
  accessToken: string;
}

/** Plain data, so it crosses the RPC boundary without relying on how errors or Responses are serialized. */
export type QueueResult =
  | { ok: true; status: number; headers: [string, string][]; body: ArrayBuffer | null }
  | { ok: false; kind: FikenFailureKind; retryAfterSeconds: number | undefined };

const BREAKER_KEY = "breakerOpenUntil";

/**
 * One instance per Fiken user. Every call to the Fiken API goes through here, because Fiken allows
 * one concurrent request per user and may ban users who break that rule. The rules themselves live
 * in core's FikenScheduler; this class gives it a home and an outbound fetch.
 */
export class FikenUserQueue extends DurableObject<Env> {
  readonly #scheduler = new FikenScheduler<QueuedRequest>({
    send: (request, signal) => sendToFiken(request, signal),
    breakerStore: {
      load: () => this.ctx.storage.get<number>(BREAKER_KEY),
      save: (openUntil) => this.ctx.storage.put(BREAKER_KEY, openUntil),
    },
    onEvent: (event) => log(`queue_${event.type}`, { ...event, type: undefined }),
  });

  async send(request: QueuedRequest): Promise<QueueResult> {
    try {
      const response = await this.#scheduler.run(request);
      const body = response.body ? await response.arrayBuffer() : null;
      return { ok: true, status: response.status, headers: [...response.headers], body };
    } catch (error) {
      if (error instanceof FikenTransportError) {
        return { ok: false, kind: error.kind, retryAfterSeconds: error.retryAfterSeconds };
      }
      throw error;
    }
  }
}

function sendToFiken(request: QueuedRequest, signal: AbortSignal): Promise<Response> {
  const url = new URL(FIKEN_API_BASE + request.path);
  if (url.origin !== new URL(FIKEN_API_BASE).origin || !url.pathname.startsWith("/api/v2/")) {
    throw new Error("Refusing a request outside the Fiken API");
  }
  return fetch(url, {
    method: request.method,
    headers: { ...request.headers, authorization: `Bearer ${request.accessToken}`, "x-request-id": crypto.randomUUID() },
    body: request.body ?? null,
    signal,
  });
}
