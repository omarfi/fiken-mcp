import { DurableObject } from "cloudflare:workers";
import { FikenScheduler, FikenTransportError, type FikenFailureKind, type FikenHttpRequest } from "@fiken-mcp/core";
import { refreshTokens, type RefreshResult } from "./auth/fiken-oauth.ts";
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
const REFRESH_REUSE_MS = 5 * 60 * 1000;

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

  /** Refreshes in flight or done in the last minutes, by a hash of the refresh token they used. */
  readonly #refreshes = new Map<string, { result: Promise<RefreshResult>; at: number }>();

  /**
   * Refreshes this user's Fiken tokens, once. Two refreshes with the same refresh token (a client
   * retry, two MCP clients) share one call to Fiken and get the same new tokens, so a rotated
   * refresh token is never sent twice.
   */
  async refreshFiken(refreshToken: string): Promise<RefreshResult> {
    const key = await sha256(refreshToken);
    const now = Date.now();
    for (const [old, entry] of this.#refreshes) if (now - entry.at > REFRESH_REUSE_MS) this.#refreshes.delete(old);
    const existing = this.#refreshes.get(key);
    if (existing) return existing.result;
    const result = refreshTokens(this.env, refreshToken);
    this.#refreshes.set(key, { result, at: now });
    const settled = await result;
    // Failures are not reused: the next attempt should ask Fiken again.
    if (!settled.ok) this.#refreshes.delete(key);
    return settled;
  }

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
    // The bearer token must not follow a redirect to another host.
    redirect: "manual",
    signal,
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
