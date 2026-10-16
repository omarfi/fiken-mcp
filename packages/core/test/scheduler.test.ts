import { describe, expect, it } from "vitest";
import { FikenTransportError } from "../src/fiken/errors.ts";
import { FikenScheduler, type BreakerStore, type SchedulerOptions } from "../src/fiken/scheduler.ts";
import type { FikenHttpRequest } from "../src/fiken/transport.ts";

/** Virtual time: sleeping advances the clock instantly, so tests measure spacing without waiting. */
class FakeClock {
  time = 0;
  readonly now = () => this.time;
  readonly sleep = (ms: number) => {
    this.time += ms;
    return Promise.resolve();
  };
}

const GET: FikenHttpRequest = { method: "GET", path: "/companies" };
const POST: FikenHttpRequest = { method: "POST", path: "/companies/x/purchases/drafts", body: "{}" };

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response(code === 204 ? null : "{}", { status: code, headers });

function setup(responses: (Response | Error)[], options: Partial<SchedulerOptions<FikenHttpRequest>> = {}) {
  const clock = new FakeClock();
  const starts: number[] = [];
  const scheduler = new FikenScheduler({
    send: () => {
      starts.push(clock.time);
      const next = responses.shift() ?? status(200);
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    now: clock.now,
    sleep: clock.sleep,
    ...options,
  });
  return { scheduler, clock, starts };
}

const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

describe("FikenScheduler", () => {
  it("never has more than one request in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const scheduler = new FikenScheduler({
      send: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return status(200);
      },
      minIntervalMs: 0,
    });
    await Promise.all(Array.from({ length: 5 }, () => scheduler.run(GET)));
    expect(maxInFlight).toBe(1);
  });

  it("keeps the queue in order and isolates failures", async () => {
    const { scheduler } = setup([status(200), timeout(), status(201)]);
    const results = await Promise.allSettled([scheduler.run(GET), scheduler.run(POST), scheduler.run(POST)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("starts at most one request every 300 ms, under Fiken's 4 per second", async () => {
    const { scheduler, starts } = setup([]);
    await Promise.all(Array.from({ length: 5 }, () => scheduler.run(GET)));
    expect(starts).toEqual([0, 300, 600, 900, 1200]);
    const perSecond = starts.filter((start) => start < 1000).length;
    expect(perSecond).toBeLessThanOrEqual(4);
  });

  it("reads the whole body before the next request starts", async () => {
    let bodyRead = false;
    // highWaterMark 0: nothing is pulled until someone reads, and the read takes a while.
    const stream = new ReadableStream(
      {
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          controller.enqueue(new TextEncoder().encode("[]"));
          controller.close();
          bodyRead = true;
        },
      },
      { highWaterMark: 0 },
    );
    const sends: boolean[] = [];
    const scheduler = new FikenScheduler({
      send: () => {
        sends.push(bodyRead);
        return Promise.resolve(sends.length === 1 ? new Response(stream) : status(200));
      },
      minIntervalMs: 0,
    });
    await Promise.all([scheduler.run(GET), scheduler.run(GET)]);
    expect(sends).toEqual([false, true]);
  });

  describe("429", () => {
    it("waits for Retry-After and retries, also for writes, since Fiken did not execute the call", async () => {
      const { scheduler, starts } = setup([status(429, { "retry-after": "2" }), status(201)]);
      const response = await scheduler.run(POST);
      expect(response.status).toBe(201);
      expect(starts).toEqual([0, 2000]);
    });

    it("backs off exponentially without Retry-After", async () => {
      const { scheduler, starts } = setup([status(429), status(429), status(200)], { breakerThreshold: 5 });
      await scheduler.run(GET);
      expect(starts).toEqual([0, 1000, 3000]);
    });

    it("opens the circuit breaker after 3 consecutive 429s and rejects calls without sending them", async () => {
      const store: BreakerStore & { saved?: number } = {
        load: () => Promise.resolve(undefined),
        save: (until) => {
          store.saved = until;
          return Promise.resolve();
        },
      };
      const { scheduler, starts, clock } = setup([status(429), status(429), status(429)], { breakerStore: store });

      await expect(scheduler.run(GET)).rejects.toMatchObject({ kind: "rate_limited", retryAfterSeconds: 60 });
      expect(starts).toHaveLength(3);
      expect(store.saved).toBe(clock.time + 60_000);

      await expect(scheduler.run(POST)).rejects.toMatchObject({ kind: "rate_limited" });
      expect(starts).toHaveLength(3);

      clock.time += 60_000;
      await expect(scheduler.run(GET)).resolves.toMatchObject({ status: 200 });
    });

    it("opens the breaker at once when Retry-After is longer than it is willing to hold the queue", async () => {
      const { scheduler, starts } = setup([status(429, { "retry-after": "120" })]);
      await expect(scheduler.run(GET)).rejects.toMatchObject({ kind: "rate_limited", retryAfterSeconds: 120 });
      expect(starts).toHaveLength(1);
    });

    it("keeps the breaker closed after a restart only if it has expired", async () => {
      const clock = new FakeClock();
      clock.time = 10_000;
      const scheduler = new FikenScheduler({
        send: () => Promise.resolve(status(200)),
        now: clock.now,
        sleep: clock.sleep,
        breakerStore: { load: () => Promise.resolve(40_000), save: () => Promise.resolve() },
      });
      await expect(scheduler.run(GET)).rejects.toMatchObject({ kind: "rate_limited", retryAfterSeconds: 30 });
      clock.time = 40_000;
      await expect(scheduler.run(GET)).resolves.toMatchObject({ status: 200 });
    });
  });

  describe("unknown outcome", () => {
    it("never retries a write that timed out", async () => {
      const { scheduler, starts } = setup([timeout(), status(201)]);
      const error = await scheduler.run(POST).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(FikenTransportError);
      expect(error).toMatchObject({ kind: "outcome_unknown" });
      expect((error as Error).message).toContain("find_*");
      expect(starts).toHaveLength(1);
    });

    it("never retries a write that got a 5xx", async () => {
      const { scheduler, starts } = setup([status(502), status(201)]);
      await expect(scheduler.run(POST)).resolves.toMatchObject({ status: 502 });
      expect(starts).toHaveLength(1);
    });

    it("retries a read once after a timeout, then gives up", async () => {
      const { scheduler, starts } = setup([timeout(), timeout()]);
      await expect(scheduler.run(GET)).rejects.toMatchObject({ kind: "unavailable" });
      expect(starts).toHaveLength(2);
    });

    it("retries a read once after a 5xx", async () => {
      const { scheduler, starts } = setup([status(503), status(200)]);
      await expect(scheduler.run(GET)).resolves.toMatchObject({ status: 200 });
      expect(starts).toHaveLength(2);
    });
  });
});
