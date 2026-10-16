import { FikenTransportError } from "./errors.ts";
import type { FikenHttpRequest } from "./transport.ts";

/** Performs one HTTP request against Fiken. The scheduler decides when, and whether to retry. */
export type RawSend<R extends FikenHttpRequest> = (request: R, signal: AbortSignal) => Promise<Response>;

/** Persists when the circuit breaker closes again, so a restart does not reopen the floodgates. */
export interface BreakerStore {
  load(): Promise<number | undefined>;
  save(openUntil: number): Promise<void>;
}

export type SchedulerEvent =
  | { type: "retry"; reason: "rate_limited" | "server_error" | "no_response"; method: string; path: string; waitMs: number }
  | { type: "breaker_open"; untilMs: number }
  | { type: "breaker_rejected"; method: string; path: string }
  | { type: "outcome_unknown"; method: string; path: string };

export interface SchedulerOptions<R extends FikenHttpRequest> {
  send: RawSend<R>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  breakerStore?: BreakerStore;
  onEvent?: (event: SchedulerEvent) => void;
  /** Minimum time between the start of two requests. 300 ms is about 3.3 per second, under Fiken's 4. */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Retries after a 429, which Fiken answers without executing the call, so writes are retried too. */
  maxRateLimitRetries?: number;
  /** Consecutive 429s that open the circuit breaker. */
  breakerThreshold?: number;
  breakerOpenMs?: number;
  /** A Retry-After longer than this opens the breaker instead of holding the queue. */
  maxRetryWaitMs?: number;
  backoffBaseMs?: number;
}

/**
 * Serializes one Fiken user's requests and applies Fiken's rules: one request at a time, at most
 * about 3 per second, backoff on 429, a circuit breaker after repeated 429s, and no automatic
 * retry of a write whose outcome is unknown.
 *
 * Platform-agnostic: the host runs one instance per Fiken user (a Durable Object on Cloudflare).
 */
export class FikenScheduler<R extends FikenHttpRequest = FikenHttpRequest> {
  readonly #send: RawSend<R>;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #breakerStore: BreakerStore | undefined;
  readonly #onEvent: (event: SchedulerEvent) => void;
  readonly #minIntervalMs: number;
  readonly #timeoutMs: number;
  readonly #maxRateLimitRetries: number;
  readonly #breakerThreshold: number;
  readonly #breakerOpenMs: number;
  readonly #maxRetryWaitMs: number;
  readonly #backoffBaseMs: number;

  #tail: Promise<unknown> = Promise.resolve();
  #nextStart = 0;
  #consecutiveRateLimits = 0;
  #breakerOpenUntil: number | undefined;
  #breakerLoaded = false;

  constructor(options: SchedulerOptions<R>) {
    this.#send = options.send;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#breakerStore = options.breakerStore;
    this.#onEvent = options.onEvent ?? (() => undefined);
    this.#minIntervalMs = options.minIntervalMs ?? 300;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxRateLimitRetries = options.maxRateLimitRetries ?? 3;
    this.#breakerThreshold = options.breakerThreshold ?? 3;
    this.#breakerOpenMs = options.breakerOpenMs ?? 60_000;
    this.#maxRetryWaitMs = options.maxRetryWaitMs ?? 10_000;
    this.#backoffBaseMs = options.backoffBaseMs ?? 1_000;
  }

  /** Queues the request behind every earlier one. The returned response's body is already fully read. */
  run(request: R): Promise<Response> {
    const result = this.#tail.then(() => this.#execute(request));
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #execute(request: R): Promise<Response> {
    const path = request.path.split("?")[0] ?? request.path;
    const write = request.method !== "GET";
    let rateLimitRetries = 0;
    let readRetried = false;

    for (;;) {
      await this.#checkBreaker(request.method, path);
      await this.#waitForSlot();

      let response: Response;
      try {
        response = await this.#attempt(request);
      } catch {
        if (write) {
          this.#onEvent({ type: "outcome_unknown", method: request.method, path });
          throw new FikenTransportError("outcome_unknown");
        }
        if (readRetried) throw new FikenTransportError("unavailable");
        readRetried = true;
        await this.#backoff("no_response", request.method, path, this.#backoffBaseMs);
        continue;
      }

      if (response.status === 429) {
        this.#consecutiveRateLimits += 1;
        const waitMs = retryAfterMs(response.headers.get("retry-after"), this.#now()) ?? this.#exponential(rateLimitRetries);
        if (this.#consecutiveRateLimits >= this.#breakerThreshold || waitMs > this.#maxRetryWaitMs) {
          const openMs = Math.max(this.#breakerOpenMs, waitMs);
          await this.#openBreaker(openMs);
          throw new FikenTransportError("rate_limited", Math.ceil(openMs / 1000));
        }
        if (rateLimitRetries >= this.#maxRateLimitRetries) return response;
        rateLimitRetries += 1;
        await this.#backoff("rate_limited", request.method, path, waitMs);
        continue;
      }

      this.#consecutiveRateLimits = 0;
      if (response.status >= 500 && !write && !readRetried) {
        readRetried = true;
        await this.#backoff("server_error", request.method, path, this.#backoffBaseMs);
        continue;
      }
      return response;
    }
  }

  /** One request, with the body read before returning: the request is in flight until it is. */
  async #attempt(request: R): Promise<Response> {
    const response = await this.#send(request, AbortSignal.timeout(this.#timeoutMs));
    const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  async #waitForSlot(): Promise<void> {
    const wait = this.#nextStart - this.#now();
    if (wait > 0) await this.#sleep(wait);
    this.#nextStart = this.#now() + this.#minIntervalMs;
  }

  async #backoff(reason: "rate_limited" | "server_error" | "no_response", method: string, path: string, waitMs: number): Promise<void> {
    this.#onEvent({ type: "retry", reason, method, path, waitMs });
    await this.#sleep(waitMs);
  }

  #exponential(retry: number): number {
    return Math.min(this.#maxRetryWaitMs, this.#backoffBaseMs * 2 ** retry);
  }

  async #checkBreaker(method: string, path: string): Promise<void> {
    if (!this.#breakerLoaded) {
      this.#breakerOpenUntil = await this.#breakerStore?.load();
      this.#breakerLoaded = true;
    }
    const until = this.#breakerOpenUntil;
    if (until !== undefined && this.#now() < until) {
      this.#onEvent({ type: "breaker_rejected", method, path });
      throw new FikenTransportError("rate_limited", Math.ceil((until - this.#now()) / 1000));
    }
  }

  async #openBreaker(openMs: number): Promise<void> {
    const until = this.#now() + openMs;
    this.#breakerOpenUntil = until;
    this.#consecutiveRateLimits = 0;
    this.#onEvent({ type: "breaker_open", untilMs: until });
    await this.#breakerStore?.save(until);
  }
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** Parses Retry-After as seconds or an HTTP date. */
function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
