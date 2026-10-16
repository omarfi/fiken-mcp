import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { FikenClient } from "../src/fiken/client.ts";
import type { FikenHttpRequest, FikenTransport } from "../src/fiken/transport.ts";
import { createFikenServer, type FikenServerOptions } from "../src/server.ts";

type Responder = (request: FikenHttpRequest) => Response | Promise<Response>;

/** A FikenTransport that records every request and answers from `respond`. */
export class MockTransport implements FikenTransport {
  readonly requests: FikenHttpRequest[] = [];
  readonly #respond: Responder;

  constructor(respond: Responder) {
    this.#respond = respond;
  }

  async send(request: FikenHttpRequest): Promise<Response> {
    this.requests.push(request);
    return this.#respond(request);
  }
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** Connects a real MCP client to a Fiken server in memory. */
export async function connect(transport: FikenTransport, options: Partial<FikenServerOptions> = {}): Promise<Client> {
  const server = createFikenServer({
    fiken: new FikenClient(transport),
    access: "read",
    // Never the real Enhetsregisteret in tests.
    lookupOrganization: () => Promise.reject(new Error("Enhetsregisteret is not available in tests")),
    ...options,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}
