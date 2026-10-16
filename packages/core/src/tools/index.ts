import { listCompanies } from "./list-companies.ts";
import type { ToolDefinition } from "./tool.ts";

export const TOOLS: readonly ToolDefinition[] = [listCompanies];
