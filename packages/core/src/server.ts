import { createMcpHandler, McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { brregLookup, BrregUnavailableError, type OrganizationLookup } from "./brreg.ts";
import type { FikenClient } from "./fiken/client.ts";
import { FikenApiError, FikenTransportError } from "./fiken/errors.ts";
import { INSTRUCTIONS } from "./instructions.ts";
import { SERVER_DISPLAY_NAME, SERVER_NAME, SERVER_VERSION } from "./server-info.ts";
import { todayInNorway, ToolError } from "./tools/common.ts";
import { TOOLS } from "./tools/index.ts";
import type { UploadLinkIssuer } from "./uploads.ts";
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
  /** Today's date in Norway, YYYY-MM-DD. Defaults to the real date; tests fix it. */
  today?: () => string;
  /** Enhetsregisteret lookup. Defaults to the public API. */
  lookupOrganization?: OrganizationLookup;
  /** One-time upload links. Without it, create_upload_link says uploads are unavailable. */
  issueUploadLink?: UploadLinkIssuer;
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

const defaultLookup = brregLookup();

function registerTool(server: McpServer, tool: ToolDefinition, options: FikenServerOptions): void {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: withoutDialect(tool.inputSchema), annotations: tool.annotations },
    async (input: Record<string, unknown>): Promise<CallToolResult> => {
      const started = Date.now();
      const company = typeof input.company === "string" ? input.company : undefined;
      const report = (outcome: ToolCallEvent["outcome"], fikenStatus?: number, failure?: string) =>
        options.onToolCall?.({ tool: tool.name, company, outcome, fikenStatus, ...(failure ? { failure } : {}), durationMs: Date.now() - started });

      try {
        const result = await tool.handler(input, {
          fiken: options.fiken,
          today: options.today?.() ?? todayInNorway(),
          lookupOrganization: options.lookupOrganization ?? defaultLookup,
          issueUploadLink: options.issueUploadLink,
        });
        report(result.isError ? "tool_error" : "ok");
        return result;
      } catch (error) {
        if (error instanceof ToolError || error instanceof BrregUnavailableError) {
          report("tool_error");
          return errorResult(error.message);
        }
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

/**
 * The same zod schema without the root `$schema` URI in the JSON the model reads. About 17 tokens per
 * tool, and JSON Schema 2020-12 is the default when it is absent. Validation is zod's, unchanged.
 */
function withoutDialect(schema: ToolDefinition["inputSchema"]): ToolDefinition["inputSchema"] {
  const standard = schema["~standard"];
  const strip = (json: Record<string, unknown>) => {
    const rest = { ...json };
    delete rest.$schema;
    return rest;
  };
  return {
    "~standard": {
      ...standard,
      jsonSchema: {
        input: (options: Parameters<typeof standard.jsonSchema.input>[0]) => strip(standard.jsonSchema.input(options)),
        output: (options: Parameters<typeof standard.jsonSchema.output>[0]) => strip(standard.jsonSchema.output(options)),
      },
    },
  } as unknown as ToolDefinition["inputSchema"];
}
