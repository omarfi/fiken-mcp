import { DurableObject } from "cloudflare:workers";
import type { FikenHttpRequest } from "@fiken-mcp/core";
import { FIKEN_API_BASE } from "./config.ts";

/** Start at most one request every 300 ms, about 3.3 per second, under Fiken's limit of 4. */
const MIN_INTERVAL_MS = 300;
const REQUEST_TIMEOUT_MS = 30_000;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export interface QueuedRequest extends FikenHttpRequest {
  /** The user's Fiken access token. Used for this request only, never stored. */
  accessToken: string;
}

/**
 * One instance per Fiken user. Serializes every call to the Fiken API, because Fiken allows only
 * one concurrent request per user and may ban users who break that rule.
 *
 * A Durable Object keeps accepting calls while it awaits `fetch`, so the serialization is an
 * explicit promise chain. M2 adds the token bucket, 429 backoff and the circuit breaker.
 */
export class FikenUserQueue extends DurableObject<Env> {
  #tail: Promise<unknown> = Promise.resolve();
  #nextStart = 0;

  send(request: QueuedRequest): Promise<Response> {
    const result = this.#tail.then(() => this.#run(request));
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #run(request: QueuedRequest): Promise<Response> {
    const url = new URL(FIKEN_API_BASE + request.path);
    if (url.origin !== new URL(FIKEN_API_BASE).origin || !url.pathname.startsWith("/api/v2/")) {
      throw new Error("Refusing a request outside the Fiken API");
    }

    const wait = this.#nextStart - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.#nextStart = Date.now() + MIN_INTERVAL_MS;

    const response = await fetch(url, {
      method: request.method,
      headers: { ...request.headers, authorization: `Bearer ${request.accessToken}`, "x-request-id": crypto.randomUUID() },
      body: request.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // The request is in flight until its body is read, so read it inside the lock.
    const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
    return new Response(body, { status: response.status, headers: response.headers });
  }
}
