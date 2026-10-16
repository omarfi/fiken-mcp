import { describe, expect, it } from "vitest";
import type { Organization } from "../src/brreg.ts";
import type { FikenHttpRequest } from "../src/fiken/transport.ts";
import { connect, json, MockTransport } from "./helpers.ts";

const COMPANY = "test-as";
const BASE = `/companies/${COMPANY}`;
const TODAY = "2026-10-16";

type Handler = (request: FikenHttpRequest) => Response;

/** Answers by "METHOD /path" (query string ignored), and records JSON bodies. */
function fiken(routes: Record<string, unknown>) {
  const transport = new MockTransport((request) => {
    const key = `${request.method} ${request.path.split("?")[0]}`;
    const route = routes[key];
    if (route === undefined) return json({ message: `no route for ${key}` }, { status: 404 });
    return typeof route === "function" ? (route as Handler)(request) : json(route);
  });
  const bodies = (method: string, path: string) =>
    transport.requests
      .filter((r) => r.method === method && r.path.split("?")[0] === path)
      .map((r) => JSON.parse(new TextDecoder().decode(r.body as ArrayBuffer)) as Record<string, unknown>);
  return { transport, bodies };
}

const created = (path: string) => () => new Response(null, { status: 201, headers: { location: `https://api.fiken.no/api/v2${path}`, "content-length": "0" } });
const ok = () => new Response(null, { status: 200, headers: { "content-length": "0" } });

const WOLLUM: Organization = {
  organizationNumber: "937587821",
  name: "WOLLUM AS",
  address: { streetAddress: "Grenseveien 21", postCode: "4313", city: "SANDNES", country: "Norge" },
  organizationForm: "AS",
  bankrupt: false,
  underLiquidation: false,
};

async function run(transport: MockTransport, name: string, args: Record<string, unknown>, lookup?: (org: string) => Promise<Organization | undefined>) {
  const client = await connect(transport, { access: "write", today: () => TODAY, ...(lookup ? { lookupOrganization: lookup } : {}) });
  return client.callTool({ name, arguments: { company: COMPANY, ...args } });
}

describe("save_contact", () => {
  it("fills name and address from Enhetsregisteret and reads the new contact back", async () => {
    const { transport, bodies } = fiken({
      [`GET ${BASE}/contacts`]: [],
      [`POST ${BASE}/contacts`]: created(`${BASE}/contacts/77`),
      [`GET ${BASE}/contacts/77`]: { contactId: 77, name: "WOLLUM AS", organizationNumber: "937587821", supplier: true },
      [`GET ${BASE}/contacts/77/contactPerson`]: [],
    });
    const result = await run(transport, "save_contact", { org_number: "937587821", supplier: true }, () => Promise.resolve(WOLLUM));
    expect(result.isError).toBeFalsy();
    expect(bodies("POST", `${BASE}/contacts`)).toEqual([
      {
        customer: false,
        supplier: true,
        name: "WOLLUM AS",
        organizationNumber: "937587821",
        address: { streetAddress: "Grenseveien 21", postCode: "4313", city: "SANDNES", country: "Norge" },
      },
    ]);
    expect(result.structuredContent).toMatchObject({ created: true, contact: { id: 77, name: "WOLLUM AS" } });
  });

  it("stops when a contact with the organization number exists", async () => {
    const { transport } = fiken({ [`GET ${BASE}/contacts`]: [{ contactId: 5, name: "Wollum AS" }] });
    const result = await run(transport, "save_contact", { org_number: "937587821", customer: true }, () => Promise.resolve(WOLLUM));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("id 5");
    expect(transport.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("refuses an invalid organization number", async () => {
    const result = await run(fiken({}).transport, "save_contact", { org_number: "937587822", customer: true });
    expect(result.isError).toBe(true);
  });

  it("asks before creating a contact with the same name as an existing one", async () => {
    const routes = {
      [`GET ${BASE}/contacts`]: [{ contactId: 9, name: "Ola Nordmann" }],
      [`POST ${BASE}/contacts`]: created(`${BASE}/contacts/10`),
      [`GET ${BASE}/contacts/10`]: { contactId: 10, name: "Ola Nordmann" },
      [`GET ${BASE}/contacts/10/contactPerson`]: [],
    };
    const first = await run(fiken(routes).transport, "save_contact", { name: "Ola nordmann", customer: true });
    expect(first.isError).toBe(true);
    expect(JSON.stringify(first.content)).toContain("allow_similar_name");
    const confirmed = await run(fiken(routes).transport, "save_contact", { name: "Ola Nordmann", customer: true, allow_similar_name: true });
    expect(confirmed.isError).toBeFalsy();
  });

  it("sends the whole contact back on update, since PUT replaces it", async () => {
    const existing = { contactId: 3, name: "Kunde AS", email: "post@kunde.no", customer: true, supplier: false, customerNumber: 10001, contactPerson: [{ contactPersonId: 1, name: "Kari", email: "k@kunde.no" }] };
    const { transport, bodies } = fiken({
      [`GET ${BASE}/contacts/3`]: existing,
      [`PUT ${BASE}/contacts/3`]: ok,
      [`GET ${BASE}/contacts/3/contactPerson`]: [],
    });
    const result = await run(transport, "save_contact", { id: 3, phone: "12345678" });
    expect(result.isError).toBeFalsy();
    const [body] = bodies("PUT", `${BASE}/contacts/3`);
    expect(body).toMatchObject({ name: "Kunde AS", email: "post@kunde.no", phoneNumber: "12345678", customer: true, contactPerson: existing.contactPerson });
    expect(body).not.toHaveProperty("customerNumber");
  });
});

describe("save_product", () => {
  it("creates with sensible defaults and converts the price to øre", async () => {
    const { transport, bodies } = fiken({
      [`POST ${BASE}/products`]: created(`${BASE}/products/4`),
      [`GET ${BASE}/products/4`]: { productId: 4, name: "Konsulenttime", unitPrice: 120000, vatType: "HIGH", incomeAccount: "3000", active: true },
    });
    const result = await run(transport, "save_product", { name: "Konsulenttime", unit_price: 1200 });
    expect(bodies("POST", `${BASE}/products`)).toEqual([{ incomeAccount: "3000", vatType: "HIGH", active: true, name: "Konsulenttime", unitPrice: 120000 }]);
    expect(result.structuredContent).toMatchObject({ created: true, product: { id: 4, unitPrice: 1200 } });
  });

  it("keeps the fields it was not asked to change", async () => {
    const { transport, bodies } = fiken({
      [`GET ${BASE}/products/4`]: { productId: 4, name: "Time", unitPrice: 100000, vatType: "HIGH", incomeAccount: "3000", active: true, note: "Intern" },
      [`PUT ${BASE}/products/4`]: ok,
    });
    await run(transport, "save_product", { id: 4, unit_price: 1100 });
    expect(bodies("PUT", `${BASE}/products/4`)).toEqual([{ name: "Time", unitPrice: 110000, vatType: "HIGH", incomeAccount: "3000", active: true, note: "Intern" }]);
  });
});

describe("save_purchase_draft", () => {
  const draftRoutes = {
    [`POST ${BASE}/purchases/drafts`]: created(`${BASE}/purchases/drafts/8`),
    [`GET ${BASE}/purchases/drafts/8`]: { draftId: 8, lines: [] },
  };

  it("links the purchase to the supplier by organization number and derives net from gross", async () => {
    const { transport, bodies } = fiken({ ...draftRoutes, [`GET ${BASE}/contacts`]: [{ contactId: 42, name: "Leverandør AS" }] });
    const result = await run(transport, "save_purchase_draft", {
      supplier_org_number: "937587821",
      date: "2026-10-01",
      due_date: "2026-10-15",
      lines: [{ description: "Kontorrekvisita", gross: 125, vat_type: "HIGH", account: "6800" }],
    });
    expect(result.isError).toBeFalsy();
    expect(bodies("POST", `${BASE}/purchases/drafts`)).toEqual([
      {
        invoiceIssueDate: "2026-10-01",
        dueDate: "2026-10-15",
        contactId: 42,
        cash: false,
        paid: false,
        lines: [{ text: "Kontorrekvisita", vatType: "HIGH", incomeAccount: "6800", gross: 12500, net: 10000 }],
        payments: [],
      },
    ]);
    expect(result.structuredContent).toMatchObject({ created: true, note: expect.stringContaining("finalize_draft") });
  });

  it("asks for the contact to be created when the organization number is unknown", async () => {
    const { transport } = fiken({ [`GET ${BASE}/contacts`]: [] });
    const result = await run(transport, "save_purchase_draft", {
      supplier_org_number: "937587821",
      date: "2026-10-01",
      lines: [{ description: "x", gross: 10, vat_type: "HIGH", account: "6800" }],
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("save_contact");
  });

  it("needs a supplier unless it is a cash purchase, and a payment account when paid", async () => {
    const line = [{ description: "Parkering", gross: 50, vat_type: "NONE", account: "7140" }];
    const noSupplier = await run(fiken(draftRoutes).transport, "save_purchase_draft", { date: TODAY, lines: line });
    expect(noSupplier.isError).toBe(true);
    const noAccount = await run(fiken(draftRoutes).transport, "save_purchase_draft", { kind: "cash", date: TODAY, lines: line });
    expect(JSON.stringify(noAccount.content)).toContain("payment_account");

    const { transport, bodies } = fiken(draftRoutes);
    await run(transport, "save_purchase_draft", { kind: "cash", date: TODAY, lines: line, payment_account: "1920:10001" });
    expect(bodies("POST", `${BASE}/purchases/drafts`)[0]).toMatchObject({
      cash: true,
      paid: true,
      payments: [{ date: TODAY, account: "1920:10001", amount: 5000 }],
    });
  });

  it("keeps the due date and supplier when only the lines change", async () => {
    const { transport, bodies } = fiken({
      [`GET ${BASE}/purchases/drafts/8`]: {
        draftId: 8,
        invoiceIssueDate: "2026-10-01",
        dueDate: "2026-10-15",
        invoiceNumber: "F-1",
        contact: { contactId: 42 },
        cash: false,
        paid: false,
        lines: [{ text: "Gammel", vatType: "HIGH", incomeAccount: "6800", net: 100, gross: 125 }],
      },
      [`PUT ${BASE}/purchases/drafts/8`]: ok,
    });
    await run(transport, "save_purchase_draft", { id: 8, lines: [{ description: "Ny", gross: 250, vat_type: "HIGH", account: "6800" }] });
    expect(bodies("PUT", `${BASE}/purchases/drafts/8`)[0]).toMatchObject({
      invoiceIssueDate: "2026-10-01",
      dueDate: "2026-10-15",
      invoiceNumber: "F-1",
      contactId: 42,
      cash: false,
      lines: [{ text: "Ny", gross: 25000, net: 20000 }],
    });
  });
});

describe("save_sale_draft", () => {
  it("is a paid cash sale by default and needs a payment account", async () => {
    const routes = { [`POST ${BASE}/sales/drafts`]: created(`${BASE}/sales/drafts/6`), [`GET ${BASE}/sales/drafts/6`]: { draftId: 6 } };
    const line = [{ description: "Vipps-salg", gross: 250, vat_type: "HIGH", account: "3000" }];
    const missing = await run(fiken(routes).transport, "save_sale_draft", { date: TODAY, lines: line });
    expect(missing.isError).toBe(true);
    const { transport, bodies } = fiken(routes);
    await run(transport, "save_sale_draft", { date: TODAY, lines: line, payment_account: "1920:10001" });
    expect(bodies("POST", `${BASE}/sales/drafts`)[0]).toMatchObject({ cash: true, paid: true, payments: [{ amount: 25000 }] });
  });
});

describe("save_invoice_draft", () => {
  it("creates an invoice draft with defaults and product lines", async () => {
    const { transport, bodies } = fiken({
      [`GET ${BASE}/bankAccounts`]: [{ bankAccountId: 1, type: "normal", bankAccountNumber: "12345678903" }],
      [`POST ${BASE}/invoices/drafts`]: created(`${BASE}/invoices/drafts/12`),
      [`GET ${BASE}/invoices/drafts/12`]: { draftId: 12, type: "invoice" },
    });
    const result = await run(transport, "save_invoice_draft", { customer_id: 5, lines: [{ product_id: 4, quantity: 3 }] });
    expect(result.isError).toBeFalsy();
    expect(bodies("POST", `${BASE}/invoices/drafts`)).toEqual([
      { customerId: 5, lines: [{ productId: 4, quantity: 3 }], type: "invoice", issueDate: TODAY, daysUntilDueDate: 14, bankAccountNumber: "12345678903" },
    ]);
  });

  it("needs description and price on a line without a product, and defaults VAT and account", async () => {
    const routes = {
      [`GET ${BASE}/bankAccounts`]: [{ bankAccountId: 1, type: "normal", bankAccountNumber: "12345678903" }],
      [`POST ${BASE}/creditNotes/drafts`]: created(`${BASE}/creditNotes/drafts/2`),
      [`GET ${BASE}/creditNotes/drafts/2`]: { draftId: 2 },
    };
    const missing = await run(fiken(routes).transport, "save_invoice_draft", { type: "credit_note", customer_id: 5, lines: [{ description: "Retur" }] });
    expect(missing.isError).toBe(true);
    const { transport, bodies } = fiken(routes);
    await run(transport, "save_invoice_draft", { type: "credit_note", customer_id: 5, lines: [{ description: "Retur", unit_price: 99.5 }] });
    expect(bodies("POST", `${BASE}/creditNotes/drafts`)[0]).toMatchObject({
      type: "credit_note",
      lines: [{ description: "Retur", quantity: 1, unitPrice: 9950, vatType: "HIGH", incomeAccount: "3000" }],
    });
  });

  it("asks for a customer", async () => {
    const result = await run(fiken({}).transport, "save_invoice_draft", { lines: [{ product_id: 4 }] });
    expect(JSON.stringify(result.content)).toContain("customer_id");
  });
});

describe("write access", () => {
  it("hides every write tool from a read-only grant", async () => {
    const client = await connect(new MockTransport(() => json([])), { access: "read" });
    const { tools } = await client.listTools();
    expect(tools.filter((tool) => tool.annotations?.readOnlyHint !== true)).toEqual([]);
  });
});
