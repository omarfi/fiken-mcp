import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "@modelcontextprotocol/client";
import { FikenScheduler } from "../../src/fiken/scheduler.ts";
import type { FikenHttpRequest, FikenTransport } from "../../src/fiken/transport.ts";
import { connect } from "../helpers.ts";

/** The only company integration tests may touch. The personal API token can reach the user's real companies too. */
export const TEST_COMPANY = "fiken-demo-slott-og-fly-as";

/** Fixed so date defaults ("so far this year", "overdue") are stable. */
export const TODAY = "2026-10-16";

const API = "https://api.fiken.no/api/v2";

/** FIKEN_TEST_TOKEN from the environment (CI) or the repository's .dev.vars (local). */
export function testToken(): string | undefined {
  if (process.env.FIKEN_TEST_TOKEN) return process.env.FIKEN_TEST_TOKEN;
  try {
    const vars = readFileSync(fileURLToPath(new URL("../../../../.dev.vars", import.meta.url)), "utf8");
    return /^FIKEN_TEST_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** Read-only: refuses every write, and every path outside the test company. */
function guard(request: FikenHttpRequest): void {
  const readOnlyPost = request.method === "POST" && request.path.startsWith(`/companies/${TEST_COMPANY}/products/salesReport`);
  if (request.method !== "GET" && !readOnlyPost) throw new Error(`Integration tests are read-only: ${request.method} ${request.path}`);
  const company = /^\/companies\/([^/?]+)/.exec(request.path)?.[1];
  if (company !== undefined && company !== TEST_COMPANY) throw new Error(`Integration tests may only use ${TEST_COMPANY}`);
}

let shared: FikenTransport | undefined;

/** One scheduler for the whole run, so tests respect Fiken's limits like production does. */
export function liveTransport(token: string): FikenTransport {
  if (shared) return shared;
  const scheduler = new FikenScheduler({
    send: (request, signal) =>
      fetch(API + request.path, {
        method: request.method,
        headers: { ...request.headers, authorization: `Bearer ${token}` },
        body: request.body ?? null,
        signal,
      }),
  });
  shared = {
    send(request) {
      guard(request);
      return scheduler.run(request);
    },
  };
  return shared;
}

export async function assertTestCompany(transport: FikenTransport): Promise<void> {
  const response = await transport.send({ method: "GET", path: `/companies/${TEST_COMPANY}`, headers: { accept: "application/json" } });
  const company = (await response.json()) as { slug?: string; testCompany?: boolean };
  if (company.slug !== TEST_COMPANY || company.testCompany !== true) throw new Error(`${TEST_COMPANY} is not a test company`);
}

export async function liveClient(token: string): Promise<Client> {
  const transport = liveTransport(token);
  await assertTestCompany(transport);
  return connect(transport, { access: "read", today: () => TODAY });
}

/** Calls a tool against the test company and returns its structured content, failing on tool errors. */
export async function call<T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: { company: TEST_COMPANY, ...args } });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  return result.structuredContent as T;
}
