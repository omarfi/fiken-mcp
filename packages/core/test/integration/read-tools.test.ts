import type { Client } from "@modelcontextprotocol/client";
import { beforeAll, describe, expect, it } from "vitest";
import { call, liveClient, liveTransport, TEST_COMPANY, testToken } from "./live.ts";

// Read-only checks of every read tool against Fiken's test company. Run with `pnpm test:integration`.
// Where possible a tool is checked against the raw API rather than against remembered numbers, so the
// tests keep working when the test company's data changes.

const token = testToken();

type Row = Record<string, unknown>;

describe.skipIf(!token)("read tools against the test company", () => {
  let client: Client;

  beforeAll(async () => {
    client = await liveClient(token ?? "");
  });

  /** A raw GET against the test company, through the same guarded transport. */
  async function raw<T>(path: string): Promise<T> {
    const response = await liveTransport(token ?? "").send({ method: "GET", path: `/companies/${TEST_COMPANY}${path}` });
    return (await response.json()) as T;
  }

  it("list_companies includes the test company", async () => {
    const { companies } = await call<{ companies: Row[] }>(client, "list_companies");
    expect(companies).toContainEqual(expect.objectContaining({ slug: TEST_COMPANY, testCompany: true }));
  });

  it("find_contacts matches part of a name, filters by role and shows details", async () => {
    const { contacts } = await call<{ contacts: Row[] }>(client, "find_contacts", { query: "demo" });
    expect(contacts.map((contact) => contact.name)).toContain("Demokunde");

    const suppliers = await call<{ contacts: Row[] }>(client, "find_contacts", { role: "supplier" });
    expect(suppliers.contacts.length).toBeGreaterThan(0);
    expect(suppliers.contacts.every((contact) => contact.supplier === true)).toBe(true);

    const first = contacts[0];
    const { contact } = await call<{ contact: Row }>(client, "find_contacts", { id: first?.id });
    expect(contact).toMatchObject({ id: first?.id, name: first?.name });
  });

  it("find_products finds a product by part of its name, which Fiken's own filter cannot", async () => {
    const all = await raw<{ name: string; unitPrice: number }[]>("/products?pageSize=100");
    const product = all[0];
    expect(product).toBeDefined();
    const { products } = await call<{ products: Row[] }>(client, "find_products", { query: product?.name.slice(0, 4).toLowerCase() });
    expect(products).toContainEqual(expect.objectContaining({ name: product?.name, unitPrice: (product?.unitPrice ?? 0) / 100 }));
  });

  it("find_invoices lists invoices and drafts, splits paid from unpaid and shows details", async () => {
    const all = await call<{ invoices: Row[]; paging: Row }>(client, "find_invoices", { limit: 100 });
    const paid = await call<{ invoices: Row[] }>(client, "find_invoices", { status: "paid", limit: 100 });
    const unpaid = await call<{ invoices: Row[] }>(client, "find_invoices", { status: "unpaid", limit: 100 });
    expect(paid.invoices.length + unpaid.invoices.length).toBe(all.invoices.length);
    expect(all.paging.total).toBe(all.invoices.length);

    const drafts = await call<{ drafts: Row[] }>(client, "find_invoices", { status: "draft" });
    const rawDrafts = await raw<unknown[]>("/invoices/drafts?pageSize=100");
    expect(drafts.drafts.length).toBe(rawDrafts.length);

    const first = all.invoices[0];
    const { invoice } = await call<{ invoice: Row }>(client, "find_invoices", { id: first?.id });
    expect(invoice).toMatchObject({ id: first?.id, gross: first?.gross });
    expect(Array.isArray(invoice.lines)).toBe(true);
  });

  it("find_invoices, find_sales and find_journal_entries list the newest first", async () => {
    const invoices = await raw<{ invoiceId: number }[]>("/invoices?pageSize=100");
    const newestInvoice = await call<{ invoices: Row[] }>(client, "find_invoices", { limit: 2 });
    expect(newestInvoice.invoices.map((row) => row.id)).toEqual(invoices.slice(-2).reverse().map((row) => row.invoiceId));

    const sales = await raw<{ saleId: number; deleted?: boolean }[]>("/sales?pageSize=100");
    const newestSale = await call<{ sales: Row[] }>(client, "find_sales", { limit: 1 });
    expect(newestSale.sales[0]?.id).toBe(sales.filter((sale) => !sale.deleted).at(-1)?.saleId);

    const entries = await raw<{ journalEntryId: number }[]>("/journalEntries?pageSize=100");
    const newestEntries = await call<{ journalEntries: Row[] }>(client, "find_journal_entries", { limit: 3 });
    expect(newestEntries.journalEntries.map((row) => row.id)).toEqual(entries.slice(-3).reverse().map((row) => row.journalEntryId));
  });

  it("find_sales and find_purchases list and show details", async () => {
    const { sales } = await call<{ sales: Row[] }>(client, "find_sales");
    expect(sales.length).toBeGreaterThan(0);
    const { sale } = await call<{ sale: Row }>(client, "find_sales", { id: sales[0]?.id });
    expect(sale.id).toBe(sales[0]?.id);

    const { purchases } = await call<{ purchases: Row[] }>(client, "find_purchases");
    expect(purchases.length).toBeGreaterThan(0);
    const { purchase } = await call<{ purchase: Row }>(client, "find_purchases", { id: purchases[0]?.id });
    expect(purchase).toMatchObject({ id: purchases[0]?.id, gross: purchases[0]?.gross });
  });

  it("find_accounts searches the chart of accounts and shows balances and bank accounts", async () => {
    const { items: accounts } = await call<{ items: Row[] }>(client, "find_accounts", { query: "mynter og sedler", limit: 100 });
    expect(accounts).toContainEqual({ code: "1901", name: "Mynter og sedler" });

    const rawBalances = await raw<{ code: string; balance: number }[]>("/accountBalances?date=2026-10-16&fromAccount=3000&toAccount=3999");
    const { items: balances } = await call<{ items: Row[] }>(client, "find_accounts", { number: "3000-3999", balance_date: "2026-10-16" });
    expect(balances).toEqual(rawBalances.map((row): unknown => expect.objectContaining({ code: row.code, balance: row.balance / 100 })));

    const { bankAccounts } = await call<{ bankAccounts: Row[] }>(client, "find_accounts", { type: "bank" });
    expect(bankAccounts.length).toBeGreaterThan(0);
    expect(typeof bankAccounts[0]?.balanceInAccounts).toBe("number");
  });

  it("find_journal_entries lists entries, filters by account and shows a transaction", async () => {
    const { journalEntries } = await call<{ journalEntries: Row[] }>(client, "find_journal_entries", { from: "2026-01-01", to: "2026-12-31", limit: 100 });
    expect(journalEntries.length).toBeGreaterThan(0);

    const { items } = await call<{ items: { lines: { account: string }[] }[] }>(client, "find_journal_entries", { account: "3000", limit: 100 });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((entry) => entry.lines.some((line) => line.account === "3000"))).toBe(true);

    const { transaction } = await call<{ transaction: Row }>(client, "find_journal_entries", { transaction_id: journalEntries[0]?.transactionId });
    expect(transaction.id).toBe(journalEntries[0]?.transactionId);
  });

  it("find_inbox answers", async () => {
    const result = await call<{ documents: Row[] }>(client, "find_inbox", { status: "all" });
    expect(Array.isArray(result.documents)).toBe(true);
  });

  it("get_report result equals the sum of the year's postings on result accounts", async () => {
    const entries = await raw<{ lines: { account: string; amount: number }[] }[]>("/journalEntries?dateGe=2026-01-01&dateLe=2026-10-16&pageSize=100");
    const posted = entries
      .flatMap((entry) => entry.lines)
      .filter((line) => Number(line.account.slice(0, 4)) >= 3000 && Number(line.account.slice(0, 4)) <= 8799)
      .reduce((sum, line) => sum + line.amount, 0);
    const report = await call<{ result: number; groups: Row[] }>(client, "get_report", { type: "result" });
    expect(report.result).toBeCloseTo(-posted / 100, 2);

    // A period that does not start on 1 January subtracts the balance the day before.
    const autumn = await call<{ result: number }>(client, "get_report", { type: "result", from: "2026-09-01", to: "2026-10-16" });
    const autumnEntries = await raw<{ lines: { account: string; amount: number }[] }[]>("/journalEntries?dateGe=2026-09-01&dateLe=2026-10-16&pageSize=100");
    const autumnPosted = autumnEntries
      .flatMap((entry) => entry.lines)
      .filter((line) => Number(line.account.slice(0, 4)) >= 3000 && Number(line.account.slice(0, 4)) <= 8799)
      .reduce((sum, line) => sum + line.amount, 0);
    expect(autumn.result).toBeCloseTo(-autumnPosted / 100, 2);
  });

  it("get_report balance balances", async () => {
    const report = await call<{ balanced: boolean; totalAssets: number }>(client, "get_report", { type: "balance" });
    expect(report.balanced).toBe(true);
    expect(report.totalAssets).toBeGreaterThan(0);
  });

  it("get_report receivables and payables match the sub-ledgers", async () => {
    const customers = await raw<{ code: string; balance: number }[]>("/accountBalances?date=2026-10-16&fromAccount=1500&toAccount=1500");
    const receivables = await call<{ total: number }>(client, "get_report", { type: "receivables" });
    const expected = customers.filter((row) => row.code.includes(":")).reduce((sum, row) => sum + row.balance, 0) / 100;
    expect(receivables.total).toBeCloseTo(expected, 2);

    const suppliers = await raw<{ code: string; balance: number }[]>("/accountBalances?date=2026-10-16&fromAccount=2400&toAccount=2400");
    const payables = await call<{ total: number }>(client, "get_report", { type: "payables" });
    const owed = -suppliers.filter((row) => row.code.includes(":")).reduce((sum, row) => sum + row.balance, 0) / 100;
    expect(payables.total).toBeCloseTo(owed, 2);
  });

  it("get_report product_sales answers for the year", async () => {
    const report = await call<{ products: Row[] }>(client, "get_report", { type: "product_sales", from: "2026-01-01", to: "2026-12-31" });
    expect(Array.isArray(report.products)).toBe(true);
  });

  it("asks which company when the user has several and none is given", async () => {
    // The personal API token reaches several companies, so leaving out company must not pick one.
    const result = await client.callTool({ name: "find_contacts", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Spør hvilket det gjelder");
  });
});
