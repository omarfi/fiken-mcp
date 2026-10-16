import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FikenClient } from "../../src/fiken/client.ts";
import { uploadAttachment } from "../../src/uploads.ts";
import { call, liveDestructiveClient, liveDestructiveTransport, TEST_COMPANY, TODAY, testToken } from "./live.ts";

// Books in the test company and annuls what it booked. Opt-in: FIKEN_DESTRUCTIVE_TESTS=1 pnpm test:integration.
// Each run leaves one invoice and the credit note that cancels it, since invoices can only be credited.
// send_document is never run here: it would e-mail a real recipient.

const token = testToken();
const enabled = Boolean(token) && process.env.FIKEN_DESTRUCTIVE_TESTS === "1";
const PREFIX = `/companies/${TEST_COMPANY}`;
const SUPPLIER = 13368164376; // "JOB-385 Testleverandør (slett meg)"
const CUSTOMER = 13366876216; // "Demokunde"
const PRODUCT = 13366887137; // "Demovare"
const MARK = "MCP-test (annulleres)";

type Row = Record<string, unknown>;

describe.skipIf(!enabled)("destructive tools against the test company", () => {
  let client: Client;
  const annul: string[] = [];
  const transport = () => liveDestructiveTransport(token ?? "");

  beforeAll(async () => {
    client = await liveDestructiveClient(token ?? "");
  });

  afterAll(async () => {
    for (const path of annul) {
      await transport()
        .send({ method: "PATCH", path: `${PREFIX}${path}?description=${encodeURIComponent("Annullert etter MCP-test")}` })
        .catch(() => undefined);
    }
  });

  it("delete_draft removes a draft", async () => {
    const { draft } = await call<{ draft: Row }>(client, "save_purchase_draft", {
      supplier_id: SUPPLIER,
      date: TODAY,
      lines: [{ description: MARK, gross: 10, vat_type: "HIGH", account: "6800" }],
    });
    await call(client, "delete_draft", { type: "purchase", id: draft.id });
    const response = await transport().send({ method: "GET", path: `${PREFIX}/purchases/drafts/${String(draft.id)}` }).catch((error: unknown) => error);
    expect(response).toMatchObject({ status: 404 });
  });

  it("purchase: draft with a receipt, finalize, pay, then annul", async () => {
    const { draft } = await call<{ draft: Row }>(client, "save_purchase_draft", {
      supplier_id: SUPPLIER,
      date: TODAY,
      due_date: TODAY,
      lines: [{ description: MARK, gross: 125, vat_type: "HIGH", account: "6800" }],
    });
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
    await uploadAttachment(new FikenClient(transport()), { companySlug: TEST_COMPANY, type: "purchase_draft", id: Number(draft.id) }, {
      name: "kvittering.pdf",
      type: "application/pdf",
      bytes: pdf.buffer,
    });

    const finalized = await call<{ id: number; document: Row }>(client, "finalize_draft", { type: "purchase", id: draft.id });
    annul.push(`/purchases/${finalized.id}/delete`);
    expect(finalized.document).toMatchObject({ gross: 125, paid: false, attachments: 1 });

    // A receipt that comes later goes on the booked purchase.
    await uploadAttachment(new FikenClient(transport()), { companySlug: TEST_COMPANY, type: "purchase", id: finalized.id }, {
      name: "kvittering-2.pdf",
      type: "application/pdf",
      bytes: pdf.buffer,
    });
    // And one from the inbox, as when a card purchase from the bank needs its receipt.
    const inboxName = `kvittering-3 ${String(finalized.id)}.pdf`;
    await uploadAttachment(new FikenClient(transport()), { companySlug: TEST_COMPANY, type: "inbox" }, { name: inboxName, type: "application/pdf", bytes: pdf.buffer });
    const { documents } = await call<{ documents: Row[] }>(client, "find_inbox", { query: inboxName });
    await call(client, "create_upload_link", { target_type: "purchase", target_id: finalized.id, inbox_document_id: documents[0]?.id });
    const withReceipts = await call<{ purchase: Row }>(client, "find_purchases", { id: finalized.id });
    expect(withReceipts.purchase).toMatchObject({ attachments: [expect.anything(), expect.anything(), expect.anything()] });
    await transport().send({ method: "DELETE", path: `${PREFIX}/inbox/${String(documents[0]?.id)}` });

    const paid = await call<{ purchase: Row }>(client, "register_payment", {
      target_type: "purchase",
      target_id: finalized.id,
      date: TODAY,
      amount: 125,
      account: "1920:10001",
    });
    expect(paid.purchase).toMatchObject({ paid: true });

    const again = await client.callTool({
      name: "register_payment",
      arguments: { company: TEST_COMPANY, target_type: "purchase", target_id: finalized.id, date: TODAY, amount: 1, account: "1920:10001" },
    });
    expect(JSON.stringify(again.content)).toContain("allerede betalt");
  }, 30_000);

  it("sale: unpaid draft, finalize, pay, then annul", async () => {
    const { draft } = await call<{ draft: Row }>(client, "save_sale_draft", {
      customer_id: CUSTOMER,
      date: TODAY,
      paid: false,
      lines: [{ description: MARK, gross: 250, vat_type: "HIGH", account: "3000" }],
    });
    const finalized = await call<{ id: number; document: Row }>(client, "finalize_draft", { type: "sale", id: draft.id });
    annul.push(`/sales/${finalized.id}/delete`);
    expect(finalized.document).toMatchObject({ gross: 250, settled: false });

    const paid = await call<{ sale: Row }>(client, "register_payment", { target_type: "sale", target_id: finalized.id, date: TODAY, amount: 250, account: "1920:10001" });
    expect(paid.sale).toMatchObject({ settled: true, outstanding: 0 });
  });

  it("journal entry: book a balanced entry, then annul", async () => {
    const booked = await call<{ transactionId: number; entries: Row[] }>(client, "create_journal_entry", {
      date: TODAY,
      description: MARK,
      lines: [{ debit: "1920:10001", credit: "8040", amount: 10 }],
    });
    annul.push(`/transactions/${booked.transactionId}/delete`);
    expect(booked.entries[0]?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ account: "8040", amount: -10 })]));
  });

  it("invoice: draft, finalize, then credit it in full", async () => {
    const { draft } = await call<{ draft: Row }>(client, "save_invoice_draft", { customer_id: CUSTOMER, lines: [{ product_id: PRODUCT, quantity: 1 }], invoice_text: MARK });
    const invoice = await call<{ id: number; document: Row }>(client, "finalize_draft", { type: "invoice", id: draft.id });
    expect(invoice.document).toMatchObject({ gross: 1875, settled: false });

    const credited = await call<{ creditNote: Row }>(client, "credit_invoice", { invoice_id: invoice.id, text: MARK });
    // Credit notes carry negative amounts and no reference back to the invoice (measured).
    expect(credited.creditNote).toMatchObject({ gross: -1875, customer: { id: CUSTOMER } });
  });
});
