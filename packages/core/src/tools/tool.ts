import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import type * as z from "zod";
import type { OrganizationLookup } from "../brreg.ts";
import type { FikenClient } from "../fiken/client.ts";
import type { UploadLinkIssuer } from "../uploads.ts";

/** What the user granted on the consent page. Write implies read. */
export type AccessLevel = "read" | "write";

export interface ToolContext {
  fiken: FikenClient;
  /** Today's date in Norway, YYYY-MM-DD. Injected so tests can fix it. */
  today: string;
  /** Enhetsregisteret. Injected so tests do not call it. */
  lookupOrganization: OrganizationLookup;
  /** Issues one-time upload links. Missing where the platform has no upload page. */
  issueUploadLink?: UploadLinkIssuer | undefined;
}

export interface ToolDefinition<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  /** `read` tools are always registered; `write` tools only for grants with write access. */
  access: AccessLevel;
  title: string;
  description: string;
  inputSchema: Input;
  annotations: ToolAnnotations;
  // Method syntax keeps tools with different inputs assignable to ToolDefinition.
  handler(input: z.infer<Input>, context: ToolContext): Promise<CallToolResult>;
}

export function defineTool<Input extends z.ZodObject>(tool: ToolDefinition<Input>): ToolDefinition<Input> {
  return tool;
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

/** Creates or changes something that can be changed back or deleted, and books nothing. */
export const REVERSIBLE_WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/** Books, deletes or otherwise cannot simply be changed back. Clients always ask before these. */
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/** Confirm-first wording every destructive tool description carries, since claude.ai drops server instructions. */
export const CONFIRM_FIRST = "Oppsummer hva som skjer, og få tydelig bekreftelse fra brukeren først.";

/** A successful result: compact JSON for the model, the same object as structured content. */
export function jsonResult(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

/** A failed call the model can act on. The message is Norwegian and says what to do next. */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
