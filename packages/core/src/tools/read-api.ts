import * as z from "zod";
import { COVERED_OPERATIONS, GATEWAY_OPERATIONS, type GatewayOperation } from "../gateway/ops.gen.ts";
import { trimResponse } from "../gateway/trim.ts";
import { companyInput, limitInput, pageInput, paging, resolveCompany, ToolError } from "./common.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";

type Value = string | number | boolean;

export const readApi = defineTool({
  name: "read_api",
  access: "read",
  title: "Kjør en leseoperasjon",
  description:
    "Kjører én leseoperasjon fra explore_api mot Fiken. Bare lesing. params: sti- og spørreparametere fra explore_api. Beløp i kroner.",
  inputSchema: z.object({
    company: companyInput,
    operation_id: z.string().min(1).describe("operation_id fra explore_api"),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    limit: limitInput,
    page: pageInput,
  }),
  annotations: READ_ONLY,
  async handler(input, { fiken }) {
    const op = findOperation(input.operation_id);
    const { path, query } = splitParams(op, input.params);

    if (op.path.includes("{companySlug}")) path.companySlug = await resolveCompany(fiken, input.company);
    const pageable = op.params.some((param) => param.name === "pageSize");
    if (pageable) {
      query.page ??= input.page;
      query.pageSize ??= input.limit;
    }

    const { data, response } = await fiken.getByTemplate(op.path, { path, query });
    const trimmed = trimResponse(data ?? null);
    const pages = pageable && Array.isArray(data) ? paging(Number(query.page), Number(query.pageSize), data.length, response) : undefined;
    // Without sortBy, Fiken lists oldest first (measured); say where the newest are.
    const sortable = op.params.some((param) => param.name === "sortBy");
    const lastPage = pages?.total ? Math.ceil(pages.total / pages.limit) - 1 : undefined;
    return jsonResult({
      operation_id: op.id,
      data: trimmed.data,
      ...(pages ? { paging: pages } : {}),
      ...(pages && !sortable && lastPage !== undefined ? { order: `Eldste først. De nyeste er på page ${lastPage}.` } : {}),
      ...(trimmed.note ? { note: trimmed.note } : {}),
    });
  },
});

function findOperation(id: string): GatewayOperation {
  const op = GATEWAY_OPERATIONS.find((candidate) => candidate.id === id);
  if (op) return op;
  const tool = COVERED_OPERATIONS[id];
  if (tool) throw new ToolError(`${id} dekkes av ${tool}. Bruk det verktøyet.`);
  throw new ToolError(`${id} er ikke en tillatt leseoperasjon. Finn operation_id med explore_api. Gatewayen kan bare lese.`);
}

/** Checks every parameter against the allowlist: known names only, the declared type, enum values, required path parameters. */
function splitParams(op: GatewayOperation, params: Record<string, Value>): { path: Record<string, string | number>; query: Record<string, Value> } {
  const path: Record<string, string | number> = {};
  const query: Record<string, Value> = {};
  const allowed = new Map(op.params.map((param) => [param.name, param]));

  for (const [name, value] of Object.entries(params)) {
    const param = allowed.get(name);
    if (!param) {
      const names = op.params.map((candidate) => candidate.name).join(", ") || "ingen";
      throw new ToolError(`Ukjent parameter «${name}» for ${op.id}. Tillatt: ${names}.`);
    }
    if (param.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new ToolError(`${name} må være et tall.`);
    if (param.type === "boolean" && typeof value !== "boolean") throw new ToolError(`${name} må være true eller false.`);
    if (param.type === "string" && typeof value === "boolean") throw new ToolError(`${name} må være tekst.`);
    if (param.enum && !param.enum.includes(String(value))) throw new ToolError(`${name} må være en av: ${param.enum.join(", ")}.`);
    // Models often send string IDs (offerId, accountCode) as numbers; Fiken gets them as text either way.
    const normalized = param.type === "string" ? String(value) : value;
    if (param.in === "path") {
      if (typeof normalized === "boolean" || normalized === "") throw new ToolError(`${name} er ugyldig.`);
      path[name] = normalized;
    } else {
      query[name] = normalized;
    }
  }

  const missing = op.params.filter((param) => param.required && params[param.name] === undefined).map((param) => param.name);
  if (missing.length > 0) throw new ToolError(`Mangler ${missing.join(", ")} for ${op.id}.`);
  return { path, query };
}
