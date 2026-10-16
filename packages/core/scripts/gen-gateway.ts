// Generates src/gateway/ops.gen.ts from spec/fiken-openapi.yaml: the GET operations read_api may run,
// and the field names that hold amounts in øre. Run with `pnpm gen:types`.
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const SPEC = new URL("../../../spec/fiken-openapi.yaml", import.meta.url);
const OUT = new URL("../src/gateway/ops.gen.ts", import.meta.url);

/** GET operations a dedicated tool already answers. read_api refuses them and names the tool. */
const COVERED: Record<string, string> = {
  getCompanies: "list_companies",
  getContacts: "find_contacts",
  getContact: "find_contacts",
  getContactContactPerson: "find_contacts",
  getProducts: "find_products",
  getProduct: "find_products",
  getInvoices: "find_invoices",
  getInvoice: "find_invoices",
  getInvoiceDrafts: "find_invoices",
  getInvoiceDraft: "find_invoices",
  getCreditNotes: "find_invoices",
  getCreditNote: "find_invoices",
  getCreditNoteDrafts: "find_invoices",
  getCreditNoteDraft: "find_invoices",
  getSales: "find_sales",
  getSale: "find_sales",
  getSaleDrafts: "find_sales",
  getSaleDraft: "find_sales",
  getPurchases: "find_purchases",
  getPurchase: "find_purchases",
  getPurchaseDrafts: "find_purchases",
  getPurchaseDraft: "find_purchases",
  getAccounts: "find_accounts",
  getAccountBalances: "find_accounts",
  getBankAccounts: "find_accounts",
  getBankBalances: "find_accounts",
  getJournalEntries: "find_journal_entries",
  getJournalEntry: "find_journal_entries",
  getTransaction: "find_journal_entries",
  getInbox: "find_inbox",
  getInboxDocument: "find_inbox",
};

/** Amount fields the spec does not mark as cents in their description (checked against the test company). */
const UNMARKED_AMOUNTS = ["amount", "fee", "net", "gross", "netAmount", "vatAmount", "outstandingBalance", "outstandingBalanceInCurrency", "totalPaid", "totalPaidInCurrency", "paymentFee"];

interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
}
interface Parameter {
  $ref?: string;
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
}
interface Operation {
  operationId: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
}

const spec = parse(readFileSync(SPEC, "utf8")) as {
  paths: Record<string, Record<string, Operation> & { parameters?: Parameter[] }>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter> };
};

const resolve = <T>(value: T & { $ref?: string }): T => {
  if (!value.$ref) return value;
  return value.$ref
    .replace(/^#\//, "")
    .split("/")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], spec) as T;
};

// Operations.
const operations = [];
for (const [path, item] of Object.entries(spec.paths)) {
  const op = item.get;
  if (!op || COVERED[op.operationId]) continue;
  const parameters = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((parameter) => resolve(parameter));
  operations.push({
    id: op.operationId,
    area: op.tags?.[0] ?? "other",
    path,
    summary: firstSentence(op.summary ?? op.description ?? ""),
    params: parameters
      .filter((parameter) => (parameter.in === "path" || parameter.in === "query") && parameter.name !== "companySlug")
      .map((parameter) => {
        const schema = resolve(parameter.schema ?? {});
        return {
          name: parameter.name,
          in: parameter.in,
          type: schema.type === "integer" || schema.type === "number" ? "number" : schema.type === "boolean" ? "boolean" : "string",
          ...(parameter.required || parameter.in === "path" ? { required: true } : {}),
          ...(schema.enum ? { enum: schema.enum } : {}),
        };
      }),
  });
}
operations.sort((a, b) => a.area.localeCompare(b.area) || a.path.localeCompare(b.path));

// Amount fields: int64 properties whose description says cents, plus the unmarked ones above.
const money = new Set<string>(UNMARKED_AMOUNTS);
const other = new Map<string, string>();
const visit = (owner: string, schema: Schema) => {
  for (const part of schema.allOf ?? []) visit(owner, resolve(part));
  for (const [name, raw] of Object.entries(schema.properties ?? {})) {
    const property = resolve(raw);
    if (property.type === "integer" && /cent|øre/i.test(property.description ?? "")) money.add(name);
    else if (property.type !== "integer" || property.format !== "int64" || !/(net|vat|gross|amount|balance|price|fee|paid|rate)/i.test(name)) {
      other.set(name, `${owner}.${name} (${property.type ?? property.$ref ?? "object"})`);
    }
  }
};
for (const [name, schema] of Object.entries(spec.components.schemas)) visit(name, schema);
const clashes = [...money].filter((name) => other.has(name));
if (clashes.length > 0) {
  throw new Error(`Amount field names also used for non-amounts: ${clashes.map((name) => other.get(name)).join(", ")}`);
}

const banner = "// Generated by scripts/gen-gateway.ts from spec/fiken-openapi.yaml. Do not edit by hand.\n";
const body = `${banner}
export interface GatewayParam {
  name: string;
  in: "path" | "query";
  type: "string" | "number" | "boolean";
  required?: true;
  enum?: readonly string[];
}

export interface GatewayOperation {
  id: string;
  area: string;
  path: string;
  summary: string;
  params: readonly GatewayParam[];
}

/** The GET operations read_api may run. No other method can be reached through the gateway. */
export const GATEWAY_OPERATIONS: readonly GatewayOperation[] = ${JSON.stringify(operations, null, 2)};

/** GET operations a dedicated tool answers, with the tool to use instead. */
export const COVERED_OPERATIONS: Readonly<Record<string, string>> = ${JSON.stringify(COVERED, null, 2)};

/** Field names that hold amounts in øre anywhere in Fiken's responses. */
export const AMOUNT_FIELDS: ReadonlySet<string> = new Set(${JSON.stringify([...money].sort())});
`;
writeFileSync(OUT, body);
console.log(`Wrote ${operations.length} operations and ${money.size} amount fields to ${OUT.pathname}`);

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/\.(\s|$)/);
  const sentence = end === -1 ? clean : clean.slice(0, end + 1);
  return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
}
