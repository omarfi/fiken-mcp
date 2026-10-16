import { describe, expect, it } from "vitest";
import type { FikenHttpRequest } from "../src/fiken/transport.ts";
import { FikenClient } from "../src/fiken/client.ts";
import type { UploadTarget } from "../src/uploads.ts";
import { uploadAttachment } from "../src/uploads.ts";
import { connect, json, MockTransport } from "./helpers.ts";

const COMPANY = "test-as";
const BASE = `/companies/${COMPANY}`;
const TODAY = "2026-10-16";

function fiken(routes: Record<string, unknown>) {
  const transport = new MockTransport((request: FikenHttpRequest) => {
    const key = `${request.method} ${request.path.split("?")[0]}`;
    const route = routes[key];
    if (route === undefined) return json({ message: `no route for ${key}` }, { status: 404 });
    return typeof route === "function" ? (route as (r: FikenHttpRequest) => Response)(request) : json(route);
  });
  const sent = (method: string) => transport.requests.filter((r) => r.method === method);
  const body = (request: FikenHttpRequest | undefined) => JSON.parse(new TextDecoder().decode(request?.body as ArrayBuffer)) as Record<string, unknown>;
  return { transport, sent, body };
}

const created = (path: string) => () => new Response(null, { status: 201, headers: { location: `https://api.fiken.no/api/v2${path}`, "content-length": "0" } });
const empty = (status: number) => () => new Response(null, { status, headers: { "content-length": "0" } });

async function run(transport: MockTransport, name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const client = await connect(transport, { access: "write", today: () => TODAY, ...extra });
  return client.callTool({ name, arguments: { company: COMPANY, ...args } });
}

describe("annotations", () => {
  it("marks every tool that books, deletes or sends as destructive, and sending as open world", async () => {
    const client = await connect(new MockTransport(() => json([])), { access: "write" });
    const { tools } = await client.listTools();
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint === true).map((tool) => tool.name).sort();
    expect(destructive).toEqual(["create_journal_entry", "credit_invoice", "delete_draft", "finalize_draft", "register_payment", "send_document"]);
    expect(tools.find((tool) => tool.name === "send_document")?.annotations?.openWorldHint).toBe(true);
    for (const name of destructive) expect(tools.find((tool) => tool.name === name)?.description).toContain("bekreftelse");
  });
});

describe("finalize_draft and delete_draft", () => {
  it("creates the document from the draft and reads it back", async () => {
    const { transport, sent } = fiken({
      [`GET ${BASE}/invoices/drafts/5`]: { draftId: 5, bankAccountNumber: "12345678903" },
      [`POST ${BASE}/invoices/drafts/5/createInvoice`]: created(`${BASE}/invoices/77`),
      [`GET ${BASE}/invoices/77`]: { invoiceId: 77, invoiceNumber: 10007, gross: 12500 },
    });
    const result = await run(transport, "finalize_draft", { type: "invoice", id: 5 });
    expect(sent("POST").map((r) => r.path)).toEqual([`${BASE}/invoices/drafts/5/createInvoice`]);
    expect(result.structuredContent).toMatchObject({ finalized: "invoice", id: 77, document: { invoiceNumber: 10007, gross: 125 } });
  });

  it("stops before Fiken's 500 when an invoice draft has no bank account", async () => {
    const { transport, sent } = fiken({ [`GET ${BASE}/invoices/drafts/5`]: { draftId: 5 } });
    const result = await run(transport, "finalize_draft", { type: "invoice", id: 5 });
    expect(JSON.stringify(result.content)).toContain("mangler bankkonto");
    expect(sent("POST")).toHaveLength(0);
  });

  it("deletes the right kind of draft", async () => {
    const { transport, sent } = fiken({ [`DELETE ${BASE}/purchases/drafts/9`]: empty(204) });
    const result = await run(transport, "delete_draft", { type: "purchase", id: 9 });
    expect(result.structuredContent).toEqual({ deleted: true, type: "purchase", id: 9 });
    expect(sent("DELETE")).toHaveLength(1);
  });
});

describe("register_payment", () => {
  it("pays an invoice through the sale behind it, in øre", async () => {
    const { transport, sent, body } = fiken({
      [`GET ${BASE}/invoices/3`]: { invoiceId: 3, sale: { saleId: 30 } },
      [`GET ${BASE}/sales/30`]: { saleId: 30, settled: false, outstandingBalance: 12500 },
      [`POST ${BASE}/sales/30/payments`]: created(`${BASE}/sales/30/payments/1`),
    });
    const result = await run(transport, "register_payment", { target_type: "invoice", target_id: 3, date: TODAY, amount: 125, account: "1920:10001" });
    expect(result.isError).toBeFalsy();
    expect(body(sent("POST")[0])).toEqual({ date: TODAY, account: "1920:10001", amount: 12500 });
  });

  it("stops when the invoice is paid, or the amount is more than what is left", async () => {
    const paid = fiken({ [`GET ${BASE}/invoices/3`]: { sale: { saleId: 30 } }, [`GET ${BASE}/sales/30`]: { saleId: 30, settled: true } });
    const done = await run(paid.transport, "register_payment", { target_type: "invoice", target_id: 3, date: TODAY, amount: 1, account: "1920" });
    expect(JSON.stringify(done.content)).toContain("allerede betalt");
    expect(paid.sent("POST")).toHaveLength(0);

    const purchase = fiken({
      [`GET ${BASE}/purchases/4`]: { purchaseId: 4, paid: false, lines: [{ netPrice: 10000, vat: 2500 }], payments: [{ date: TODAY, account: "1920", amount: 5000 }] },
    });
    const tooMuch = await run(purchase.transport, "register_payment", { target_type: "purchase", target_id: 4, date: TODAY, amount: 100, account: "1920" });
    expect(JSON.stringify(tooMuch.content)).toContain("75 kr");
    expect(purchase.sent("POST")).toHaveLength(0);
  });
});

describe("create_journal_entry", () => {
  const routes = {
    [`GET ${BASE}/accounts/1920`]: { code: "1920", name: "Bank" },
    [`GET ${BASE}/accounts/8040`]: { code: "8040", name: "Renteinntekt" },
    [`POST ${BASE}/generalJournalEntries`]: created(`${BASE}/transactions/55`),
    [`GET ${BASE}/transactions/55`]: { transactionId: 55, entries: [{ journalEntryId: 1, date: TODAY, description: "Renter", lines: [{ account: "1920", amount: 1000 }] }] },
  };

  it("books a balanced entry, never as open, and reads the transaction back", async () => {
    const { transport, sent, body } = fiken(routes);
    const result = await run(transport, "create_journal_entry", {
      date: TODAY,
      description: "Renter",
      lines: [
        { debit: "1920", amount: 10 },
        { credit: "8040", amount: 10 },
      ],
    });
    expect(result.isError).toBeFalsy();
    expect(body(sent("POST")[0])).toMatchObject({
      open: false,
      journalEntries: [{ date: TODAY, lines: [{ amount: 1000, debitAccount: "1920" }, { amount: 1000, creditAccount: "8040" }] }],
    });
    expect(result.structuredContent).toMatchObject({ booked: true, transactionId: 55 });
  });

  it("refuses unbalanced lines, unknown accounts and unknown VAT codes before calling Fiken to book", async () => {
    const cases: [Record<string, unknown>[], string][] = [
      [[{ debit: "1920", amount: 10 }, { credit: "8040", amount: 9 }], "ikke lik kredit"],
      [[{ debit: "1920", credit: "9999", amount: 10 }], "9999 finnes ikke"],
      [[{ debit: "1920", credit: "8040", amount: 10, debit_vat_code: 99 }], "MVA-kode 99"],
      [[{ amount: 10 }], "mangler både"],
    ];
    for (const [lines, message] of cases) {
      const { transport, sent } = fiken(routes);
      const result = await run(transport, "create_journal_entry", { date: TODAY, description: "x", lines });
      expect(JSON.stringify(result.content), message).toContain(message);
      expect(sent("POST"), message).toHaveLength(0);
    }
  });
});

describe("credit_invoice and send_document", () => {
  it("credits a whole invoice, or part of it with lines in øre", async () => {
    const routes = {
      [`GET ${BASE}/invoices/3`]: { invoiceId: 3 },
      [`POST ${BASE}/creditNotes/full`]: created(`${BASE}/creditNotes/8`),
      [`POST ${BASE}/creditNotes/partial`]: created(`${BASE}/creditNotes/9`),
      [`GET ${BASE}/creditNotes/8`]: { creditNoteId: 8, gross: 12500 },
      [`GET ${BASE}/creditNotes/9`]: { creditNoteId: 9, gross: 6250 },
    };
    const full = fiken(routes);
    await run(full.transport, "credit_invoice", { invoice_id: 3 });
    expect(full.body(full.sent("POST")[0])).toEqual({ issueDate: TODAY, invoiceId: 3 });

    const partial = fiken(routes);
    const result = await run(partial.transport, "credit_invoice", { invoice_id: 3, lines: [{ description: "Retur", unit_price: 50 }] });
    expect(partial.body(partial.sent("POST")[0])).toMatchObject({
      invoiceId: 3,
      lines: [{ description: "Retur", quantity: 1, unitPrice: 5000, vatType: "HIGH", incomeAccount: "3000" }],
    });
    expect(result.structuredContent).toMatchObject({ credited: true, creditNote: { id: 9, gross: 62.5 } });
  });

  it("sends an invoice with the chosen method", async () => {
    const { transport, sent, body } = fiken({ [`POST ${BASE}/invoices/send`]: empty(200) });
    await run(transport, "send_document", { type: "invoice", id: 77, method: "email", recipient_email: "a@example.com" });
    expect(body(sent("POST")[0])).toMatchObject({ invoiceId: 77, method: ["email"], recipientEmail: "a@example.com", includeDocumentAttachments: true });
  });
});

describe("uploads", () => {
  it("create_upload_link checks the target exists and returns the link", async () => {
    const targets: UploadTarget[] = [];
    const issue = (target: UploadTarget) => {
      targets.push(target);
      return Promise.resolve({ url: "https://example.test/upload/abc", expiresAt: "2026-10-16T12:15:00.000Z" });
    };
    const { transport } = fiken({ [`GET ${BASE}/purchases/drafts/8`]: { draftId: 8 } });
    const result = await run(transport, "create_upload_link", { target_type: "purchase_draft", target_id: 8 }, { issueUploadLink: issue });
    expect(result.structuredContent).toMatchObject({ url: "https://example.test/upload/abc" });
    expect(targets).toEqual([{ companySlug: COMPANY, type: "purchase_draft", id: 8 }]);

    const missing = await run(fiken({}).transport, "create_upload_link", { target_type: "purchase_draft", target_id: 9 }, { issueUploadLink: issue });
    expect(missing.isError).toBe(true);
    expect(targets).toHaveLength(1);
  });

  it("sends the file as multipart to the target's attachment endpoint, and refuses other file types", async () => {
    const { transport, sent } = fiken({ [`POST ${BASE}/sales/drafts/6/attachments`]: created(`${BASE}/sales/drafts/6/attachments/1`) });
    const file = { name: "kvittering.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4").buffer };
    await uploadAttachment(new FikenClient(transport), { companySlug: COMPANY, type: "sale_draft", id: 6 }, file);
    const request = sent("POST")[0];
    expect(request?.headers?.["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(new TextDecoder().decode(request?.body as ArrayBuffer)).toContain('filename="kvittering.pdf"');

    await expect(uploadAttachment(new FikenClient(transport), { companySlug: COMPANY, type: "inbox" }, { ...file, name: "virus.exe" })).rejects.toThrow("PDF");
  });
});
