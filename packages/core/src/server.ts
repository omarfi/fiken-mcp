import { createMcpHandler, McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import type { FikenClient } from "./fiken/client.ts";
import { FikenApiError, FikenTransportError } from "./fiken/errors.ts";
import { INSTRUCTIONS } from "./instructions.ts";
import { SERVER_DISPLAY_NAME, SERVER_NAME, SERVER_VERSION } from "./server-info.ts";
import { TOOLS } from "./tools/index.ts";
import { errorResult, type AccessLevel, type ToolDefinition } from "./tools/tool.ts";

/** Metadata about one tool call, for logging. Never contains accounting data or tokens. */
export interface ToolCallEvent {
  tool: string;
  company: string | undefined;
  outcome: "ok" | "tool_error" | "fiken_error" | "transport_error" | "internal_error";
  /** Set for transport errors: why Fiken gave no usable response. */
  failure?: string | undefined;
  fikenStatus: number | undefined;
  durationMs: number;
}

export interface FikenServerOptions {
  fiken: FikenClient;
  access: AccessLevel;
  onToolCall?: (event: ToolCallEvent) => void;
  /** Called with unexpected errors. The model only gets a generic message. */
  onError?: (error: unknown) => void;
}

/** Builds the MCP server for one request: the tools this grant may use, bound to this user's Fiken client. */
export function createFikenServer(options: FikenServerOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: SERVER_DISPLAY_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of TOOLS) {
    if (tool.access === "write" && options.access !== "write") continue;
    registerTool(server, tool, options);
  }
  return server;
}

/**
 * Serves one MCP request over Streamable HTTP. Stateless: both 2026-07-28 clients and
 * 2025-era clients (without sessions) get a fresh server per request.
 */
export function handleMcpRequest(request: Request, options: FikenServerOptions): Promise<Response> {
  const handler = createMcpHandler(() => createFikenServer(options), {
    legacy: "stateless",
    responseMode: "json",
    onerror: options.onError,
  });
  return handler.fetch(request);
}

function registerTool(server: McpServer, tool: ToolDefinition, options: FikenServerOptions): void {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    async (input: Record<string, unknown>): Promise<CallToolResult> => {
      const started = Date.now();
      const company = typeof input.company === "string" ? input.company : undefined;
      const report = (outcome: ToolCallEvent["outcome"], fikenStatus?: number, failure?: string) =>
        options.onToolCall?.({ tool: tool.name, company, outcome, fikenStatus, ...(failure ? { failure } : {}), durationMs: Date.now() - started });

      try {
        const result = await tool.handler(input, { fiken: options.fiken });
        report(result.isError ? "tool_error" : "ok");
        return result;
      } catch (error) {
        if (error instanceof FikenApiError) {
          report("fiken_error", error.status);
          return errorResult(error.message);
        }
        if (error instanceof FikenTransportError) {
          report("transport_error", undefined, error.kind);
          return errorResult(error.message);
        }
        report("internal_error");
        options.onError?.(error);
        return errorResult("Noe gikk galt i koblingen til Fiken. Prøv igjen, og sjekk resultatet med et find_*-verktøy før et nytt forsøk på skriving.");
      }
    },
  );
}
