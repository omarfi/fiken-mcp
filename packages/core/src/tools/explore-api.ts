import * as z from "zod";
import { GATEWAY_OPERATIONS, type GatewayParam } from "../gateway/ops.gen.ts";
import { ToolError } from "./common.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";

const PAGING = new Set(["page", "pageSize"]);

export const exploreApi = defineTool({
  name: "explore_api",
  access: "read",
  title: "Andre leseoperasjoner i Fiken",
  description:
    "Viser leseoperasjoner de andre verktøyene ikke dekker: tilbud, ordrebekreftelser, gjentakende fakturaer, prosjekter, timer, EHF, " +
    "vedlegg, betalinger og periodiseringer. Uten area: områdene. Med area: operasjonene med parametere, til bruk i read_api.",
  inputSchema: z.object({ area: z.string().min(1).optional().describe("Område fra listen, f.eks. offers") }),
  annotations: READ_ONLY,
  handler(input) {
    if (!input.area) {
      const counts = new Map<string, number>();
      for (const op of GATEWAY_OPERATIONS) counts.set(op.area, (counts.get(op.area) ?? 0) + 1);
      return Promise.resolve(
        jsonResult({
          areas: [...counts].map(([area, operations]) => ({ area, operations })),
          note: "Kontakter, produkter, fakturaer, salg, kjøp, kontoer, bilag og innboks har egne verktøy.",
        }),
      );
    }

    const area = input.area.toLowerCase();
    const operations = GATEWAY_OPERATIONS.filter((op) => op.area.toLowerCase() === area);
    if (operations.length === 0) throw new ToolError(`Ukjent område «${input.area}». Kall explore_api uten area for listen.`);
    return Promise.resolve(
      jsonResult({
        area: operations[0]?.area,
        operations: operations.map((op) => ({
          operation_id: op.id,
          path: op.path.replace("/companies/{companySlug}", ""),
          summary: op.summary,
          params: op.params.filter((param) => !PAGING.has(param.name)).map(describeParam),
        })),
        note: "Sideinndeling styres med limit og page i read_api.",
      }),
    );
  },
});

function describeParam(param: GatewayParam): string {
  const details = [param.type, param.required ? "påkrevd" : undefined, param.enum ? param.enum.join("|") : undefined].filter(Boolean);
  return `${param.name} (${details.join(", ")})`;
}
