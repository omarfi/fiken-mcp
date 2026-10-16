import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, liveWriteClient, liveWriteTransport, TEST_COMPANY, testToken } from "./live.ts";

// Creates, changes and reads back drafts, contacts and products in the test company, then deletes
// everything it made. Nothing is booked. Run with `pnpm test:integration`.

const token = testToken();
const PREFIX = `/companies/${TEST_COMPANY}`;
const DEMO_CUSTOMER = 13366876216; // "Demokunde"
const DEMO_PRODUCT = 13366887137; // "Demovare"
const MARK = "MCP-test (slettes)";

type Row = Record<string, unknown>;

describe.skipIf(!token)("write tools against the test company", () => {
  let client: Client;
  const cleanup: string[] = [];
  const write = () => liveWriteTransport(token ?? "");

  beforeAll(async () => {
    client = await liveWriteClient(token ?? "");
  });

  afterAll(async () => {
    // Drafts first, since they point at contacts and products.
    for (const path of cleanup.sort((a, b) => Number(b.includes("/drafts/")) - Number(a.includes("/drafts/")))) {
      await write().send({ method: "DELETE", path: PREFIX + path }).catch(() => undefined);
    }
  });

  async function raw<T>(path: string): Promise<T> {
    const response = await write().send({ method: "GET", path: PREFIX + path, headers: { accept: "application/json" } });
    return (await response.json()) as T;
  }

  it("save_contact stops on an existing organization number, using the real Enhetsregisteret", async () => {
    // WOLLUM AS (937587821) is a customer in the test company.
    const result = await client.callTool({ name: "save_contact", arguments: { company: TEST_COMPANY, org_number: "937587821", customer: true } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("finnes allerede");
  });

  it("save_contact creates, adds a contact person, and updates without losing fields", async () => {
    const created = await call<{ created: boolean; contact: Row }>(client, "save_contact", {
      name: `Leverandør ${MARK}`,
      email: "leverandor@example.com",
      supplier: true,
      contact_persons: [{ name: "Kari Test", email: "kari@example.com" }],
    });
    const id = Number(created.contact.id);
    cleanup.push(`/contacts/${id}`);
    expect(created).toMatchObject({ created: true, contact: { supplier: true, email: "leverandor@example.com", contactPersons: [{ name: "Kari Test" }] } });

    const updated = await call<{ contact: Row }>(client, "save_contact", { id, phone: "12345678" });
    expect(updated.contact).toMatchObject({ email: "leverandor@example.com", phoneNumber: "12345678", contactPersons: [{ name: "Kari Test" }] });
  });

  it("save_product creates and updates without losing fields", async () => {
    const created = await call<{ product: Row }>(client, "save_product", { name: `Produkt ${MARK}`, unit_price: 99.5, product_number: "MCP-1" });
    const id = Number(created.product.id);
    cleanup.push(`/products/${id}`);
    expect(created.product).toMatchObject({ unitPrice: 99.5, vatType: expect.stringMatching(/^high$/i), incomeAccount: "3000" });

    const updated = await call<{ product: Row }>(client, "save_product", { id, unit_price: 120 });
    expect(updated.product).toMatchObject({ unitPrice: 120, productNumber: "MCP-1" });
  });

  it("save_purchase_draft derives net from gross, keeps fields on update and attaches an inbox document", async () => {
    const created = await call<{ draft: Row }>(client, "save_purchase_draft", {
      supplier_id: 13368164376,
      date: "2026-10-16",
      due_date: "2026-10-30",
      invoice_number: "MCP-1",
      lines: [{ description: MARK, gross: 125, vat_type: "HIGH", account: "6800" }],
    });
    const id = Number(created.draft.id);
    cleanup.push(`/purchases/drafts/${id}`);
    const stored = await raw<{ lines: { net: number; gross: number }[] }>(`/purchases/drafts/${id}`);
    expect(stored.lines).toEqual([expect.objectContaining({ net: 10000, gross: 12500 })]);

    await call(client, "save_purchase_draft", { id, lines: [{ description: MARK, gross: 250, vat_type: "HIGH", account: "6800" }] });
    const changed = await raw<{ dueDate: string; invoiceNumber: string; contact: { contactId: number } }>(`/purchases/drafts/${id}`);
    expect(changed).toMatchObject({ dueDate: "2026-10-30", invoiceNumber: "MCP-1", contact: { contactId: 13368164376 } });

    // A tiny PDF in the inbox, then attached to the draft by its inbox ID.
    const pdf = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj " +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
    );
    const form = new FormData();
    form.set("name", `Kvittering ${MARK}`);
    form.set("filename", "kvittering.pdf");
    form.set("file", new Blob([pdf], { type: "application/pdf" }), "kvittering.pdf");
    const multipart = new Request("https://upload.invalid", { method: "POST", body: form });
    const uploaded = await write().send({
      method: "POST",
      path: `${PREFIX}/inbox`,
      headers: { "content-type": multipart.headers.get("content-type") ?? "", accept: "application/json" },
      body: await multipart.arrayBuffer(),
    });
    expect(uploaded.status).toBe(201);
    const inboxId = Number(uploaded.headers.get("location")?.split("/").at(-1));
    cleanup.push(`/inbox/${inboxId}`);

    const attached = await call<{ draft: { attachments?: Row[] } }>(client, "save_purchase_draft", { id, inbox_document_id: inboxId });
    expect(attached.draft.attachments).toHaveLength(1);
  });

  it("save_sale_draft makes a paid cash sale", async () => {
    const created = await call<{ draft: Row }>(client, "save_sale_draft", {
      date: "2026-10-16",
      lines: [{ description: MARK, gross: 250, vat_type: "HIGH", account: "3000" }],
      payment_account: "1920:10001",
    });
    cleanup.push(`/sales/drafts/${Number(created.draft.id)}`);
    expect(created.draft).toMatchObject({ cash: true, paid: true, gross: 250, net: 200 });
  });

  it("save_invoice_draft makes invoice, credit note and offer drafts and keeps lines on update", async () => {
    const invoice = await call<{ draft: Row }>(client, "save_invoice_draft", {
      customer_id: DEMO_CUSTOMER,
      lines: [{ product_id: DEMO_PRODUCT, quantity: 2 }, { description: MARK, unit_price: 99.5 }],
      your_reference: "MCP",
    });
    const id = Number(invoice.draft.id);
    cleanup.push(`/invoices/drafts/${id}`);
    expect(invoice.draft).toMatchObject({ type: "invoice", customer: { id: DEMO_CUSTOMER }, daysUntilDueDate: 14 });
    expect(invoice.draft.lines).toHaveLength(2);

    const updated = await call<{ draft: Row }>(client, "save_invoice_draft", { id, your_reference: "MCP 2" });
    expect(updated.draft).toMatchObject({ yourReference: "MCP 2" });
    expect(updated.draft.lines).toHaveLength(2);

    for (const type of ["credit_note", "offer"]) {
      const draft = await call<{ draft: Row }>(client, "save_invoice_draft", {
        type,
        customer_id: DEMO_CUSTOMER,
        lines: [{ description: MARK, unit_price: 10 }],
      });
      cleanup.push(`/${type === "offer" ? "offers" : "creditNotes"}/drafts/${Number(draft.draft.id)}`);
      expect(draft.draft).toMatchObject({ type });
    }
  });
});
