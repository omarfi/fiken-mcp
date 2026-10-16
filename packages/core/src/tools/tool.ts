import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import type * as z from "zod";
import type { FikenClient } from "../fiken/client.ts";

/** What the user granted on the consent page. Write implies read. */
export type AccessLevel = "read" | "write";

export interface ToolContext {
  fiken: FikenClient;
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

/** A successful result: compact JSON for the model, the same object as structured content. */
export function jsonResult(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

/** A failed call the model can act on. The message is Norwegian and says what to do next. */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
