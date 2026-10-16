import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { AMOUNT_FIELDS, COVERED_OPERATIONS, GATEWAY_OPERATIONS } from "../src/gateway/ops.gen.ts";
import { MAX_RESPONSE_CHARS, trimResponse } from "../src/gateway/trim.ts";
import { connect, json, MockTransport } from "./helpers.ts";

const spec = parse(readFileSync(new URL("../../../spec/fiken-openapi.yaml", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string }>>;
};
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const specOperations = Object.entries(spec.paths).flatMap(([path, item]) =>
  METHODS.filter((method) => item[method]).map((method) => ({ path, method, id: item[method]?.operationId ?? "" })),
);

async function readApi(args: Record<string, unknown>, respond: () => Response = () => json([])) {
  const transport = new MockTransport(respond);
  const client = await connect(transport);
  const result = await client.callTool({ name: "read_api", arguments: { company: "test-as", ...args } });
  return { result, transport, text: JSON.stringify(result.content) };
}

describe("gateway allowlist", () => {
  it("contains only GET operations, each exactly as in the spec", () => {
    for (const op of GATEWAY_OPERATIONS) {
      expect(spec.paths[op.path]?.get?.operationId, op.id).toBe(op.id);
    }
  });

  it("covers every GET in the spec, either here or through a dedicated tool", () => {
    const gets = specOperations.filter((op) => op.method === "get").map((op) => op.id);
    const reachable = new Set([...GATEWAY_OPERATIONS.map((op) => op.id), ...Object.keys(COVERED_OPERATIONS)]);
    expect(gets.filter((id) => !reachable.has(id))).toEqual([]);
  });

  it("refuses every operation that is not a GET, without calling Fiken", async () => {
    const writes = specOperations.filter((op) => op.method !== "get");
    expect(writes.length).toBeGreaterThan(100);
    for (const op of writes) {
      const { result, transport } = await readApi({ operation_id: op.id });
      expect(result.isError, op.id).toBe(true);
      expect(transport.requests, op.id).toHaveLength(0);
    }
  });

  it("points to the dedicated tool for operations it covers", async () => {
    const { result, text, transport } = await readApi({ operation_id: "getInvoices" });
    expect(result.isError).toBe(true);
    expect(text).toContain("find_invoices");
    expect(transport.requests).toHaveLength(0);
  });
});

describe("read_api parameters", () => {
  it("encodes path parameters, so a value cannot change the path", async () => {
    const { transport } = await readApi({ operation_id: "getAccount", params: { accountCode: "1500:10001/../../user?x=1" } }, () => json({}));
    expect(transport.requests[0]?.path).toBe("/companies/test-as/accounts/1500%3A10001%2F..%2F..%2Fuser%3Fx%3D1");
  });

  it("refuses unknown parameters, wrong types, invalid enum values and missing path parameters", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ operation_id: "getOffers", params: { foo: 1 } }, "Ukjent parameter"],
      [{ operation_id: "getTimeEntries", params: { projectId: "abc" } }, "må være et tall"],
      [{ operation_id: "getOffer" }, "Mangler offerId"],
      [{ operation_id: "getTimeEntries", params: { invoiced: "yes" } }, "true eller false"],
      [{ operation_id: "doesNotExist" }, "explore_api"],
    ];
    for (const [args, message] of cases) {
      const { result, text, transport } = await readApi(args);
      expect(result.isError, message).toBe(true);
      expect(text).toContain(message);
      expect(transport.requests).toHaveLength(0);
    }
  });

  it("maps limit and page to Fiken's paging for list operations", async () => {
    const { transport, result } = await readApi({ operation_id: "getOffers", limit: 5, page: 1 }, () =>
      json([{ offerId: 1 }], { headers: { "Fiken-Api-Result-Count": "11" } }),
    );
    expect(transport.requests[0]?.path).toBe("/companies/test-as/offers?page=1&pageSize=5");
    expect(result.structuredContent).toMatchObject({ paging: { page: 1, limit: 5, total: 11, more: true } });
  });

  it("accepts a number for a string ID, as models often send", async () => {
    const { transport } = await readApi({ operation_id: "getOffer", params: { offerId: 42 } }, () => json({}));
    expect(transport.requests[0]?.path).toBe("/companies/test-as/offers/42");
  });

  it("calls operations outside a company without a company slug", async () => {
    const { transport } = await readApi({ operation_id: "getUser" }, () => json({ name: "A", email: "a@example.com" }));
    expect(transport.requests[0]?.path).toBe("/user");
  });
});

describe("response trimming", () => {
  it("converts amount fields from øre to kroner, at any depth", () => {
    const { data } = trimResponse([{ net: 10000, vat: 2500, lines: [{ netPrice: 1999, quantity: 3 }], offerId: 123456 }]);
    expect(data).toEqual([{ net: 100, vat: 25, lines: [{ netPrice: 19.99, quantity: 3 }], offerId: 123456 }]);
  });

  it("drops download links that need an API token and keeps the ones that open in Fiken", () => {
    const { data } = trimResponse({ attachment: { downloadUrl: "https://api.fiken.no/x", downloadUrlWithFikenNormalUserCredentials: "https://fiken.no/x" } });
    expect(data).toEqual({ attachment: { downloadUrlWithFikenNormalUserCredentials: "https://fiken.no/x" } });
  });

  it("caps the response size and says so", () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({ id: index, description: "x".repeat(100) }));
    const trimmed = trimResponse(rows);
    expect(JSON.stringify(trimmed.data).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(trimmed.note).toContain("limit");
  });

  it("knows the amount fields Fiken uses without marking them as cents", () => {
    for (const name of ["amount", "outstandingBalance", "netAmount", "vatAmount", "fee"]) expect(AMOUNT_FIELDS.has(name), name).toBe(true);
    for (const name of ["debitVatCode", "creditVatCode", "quantity", "stock", "vatInPercent"]) expect(AMOUNT_FIELDS.has(name), name).toBe(false);
  });
});

describe("explore_api", () => {
  it("lists areas without calling Fiken, and operations with their parameters for an area", async () => {
    const transport = new MockTransport(() => json([]));
    const client = await connect(transport);
    const areas = await client.callTool({ name: "explore_api", arguments: {} });
    expect((areas.structuredContent as { areas: { area: string }[] }).areas.map((row) => row.area)).toContain("offers");
    const offers = await client.callTool({ name: "explore_api", arguments: { area: "Offers" } });
    expect(offers.structuredContent).toMatchObject({
      area: "offers",
      operations: expect.arrayContaining([expect.objectContaining({ operation_id: "getOffer", params: ["offerId (string, påkrevd)"] })]),
    });
    expect(transport.requests).toHaveLength(0);
  });
});
