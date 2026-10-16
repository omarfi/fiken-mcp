import * as z from "zod";
import { MAX_PAGE_SIZE, type FikenClient } from "../fiken/client.ts";
import { companyInput, compact, dateInput, fetchPages, kr, limitInput, pageInput, pageLocally, resolveCompany, ToolError } from "./common.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";

const MAX_PAGES = 10;

export const findAccounts = defineTool({
  name: "find_accounts",
  access: "read",
  title: "Kontoplan og saldo",
  description:
    "Kontoplan, saldo og bankkontoer, i kroner. Med balance_date: saldo per konto med bevegelse (resultatkontoer: hittil i år). " +
    "type=bank: saldo i regnskapet og fra banken. Valg av konto: https://kontohjelp.fiken.no",
  inputSchema: z.object({
    company: companyInput,
    type: z.enum(["all", "bank"]).default("all"),
    query: z.string().min(1).optional().describe("Del av kontonavn eller kontonummer"),
    number: z
      .string()
      .refine((value) => /^\d{4}(:\d{5})?(-\d{4})?$/.test(value), "Kontonummer som 1920, 1500:10001 eller intervall 3000-3999")
      .optional()
      .describe("Kontonummer (1920), reskontro (1500:10001) eller intervall (3000-3999)"),
    balance_date: dateInput("Saldo per dato (ÅÅÅÅ-MM-DD)").optional(),
    limit: limitInput,
    page: pageInput,
  }),
  annotations: READ_ONLY,
  async handler(input, { fiken, today }) {
    const companySlug = await resolveCompany(fiken, input.company);
    if (input.type === "bank") return jsonResult({ bankAccounts: await bankAccounts(fiken, companySlug, input.balance_date ?? today) });

    const range = parseNumber(input.number);
    const matches = (code: string, name: string) =>
      (range.exact === undefined || code === range.exact) &&
      (!input.query || `${code} ${name}`.toLowerCase().includes(input.query.toLowerCase()));

    if (input.balance_date) {
      const { items, complete } = await fetchPages(
        (page) =>
          fiken.api.GET("/companies/{companySlug}/accountBalances", {
            params: {
              path: { companySlug },
              query: { date: input.balance_date ?? today, fromAccount: range.from, toAccount: range.to, page, pageSize: MAX_PAGE_SIZE },
            },
          }),
        MAX_PAGES,
      );
      const balances = items
        .filter((item) => matches(item.code ?? "", item.name ?? ""))
        .map((item) => ({ code: item.code, name: item.name, balance: kr(item.balance) }));
      return jsonResult({ date: input.balance_date, ...pageLocally(balances, input.page, input.limit), ...truncatedNote(complete) });
    }

    const { items, complete } = await fetchPages(
      (page) =>
        fiken.api.GET("/companies/{companySlug}/accounts", {
          params: { path: { companySlug }, query: { fromAccount: range.from, toAccount: range.to, page, pageSize: MAX_PAGE_SIZE } },
        }),
      MAX_PAGES,
    );
    const accounts = items.filter((item) => matches(item.code ?? "", item.name ?? "")).map((item) => ({ code: item.code, name: item.name }));
    return jsonResult({ ...pageLocally(accounts, input.page, input.limit), ...truncatedNote(complete) });
  },
});

async function bankAccounts(fiken: FikenClient, companySlug: string, date: string) {
  const path = { companySlug };
  const { data: accounts } = await fiken.api.GET("/companies/{companySlug}/bankAccounts", {
    params: { path, query: { pageSize: MAX_PAGE_SIZE, inactive: false } },
  });
  if (!accounts?.length) return [];
  const { data: ledger } = await fiken.api.GET("/companies/{companySlug}/accountBalances", {
    params: { path, query: { date, fromAccount: 1900, toAccount: 1999, pageSize: MAX_PAGE_SIZE } },
  });
  const { data: bank } = await fiken.api.GET("/companies/{companySlug}/bankBalances", {
    params: { path, query: { date, pageSize: MAX_PAGE_SIZE } },
  });
  return accounts.map((account) => {
    const fromBank = bank?.find((balance) => balance.bankAccountId === account.bankAccountId);
    return compact({
      id: account.bankAccountId,
      name: account.name,
      account: account.accountCode,
      bankAccountNumber: account.bankAccountNumber,
      type: account.type,
      date,
      balanceInAccounts: kr(ledger?.find((balance) => balance.code === account.accountCode)?.balance ?? 0),
      balanceFromBank: kr(fromBank?.amount),
      balanceFromBankDate: fromBank?.date,
      reconciledBalance: kr(account.reconciledBalance),
      reconciledDate: account.reconciledDate,
    });
  });
}

/** "1920" → one account, "1500:10001" → one sub-ledger account, "3000-3999" → a range. */
function parseNumber(number: string | undefined): { from?: number; to?: number; exact?: string } {
  if (!number) return {};
  const [code = "", end] = number.split("-");
  const main = Number(code.slice(0, 4));
  if (end !== undefined) {
    if (code.includes(":")) throw new ToolError("Et intervall kan ikke inneholde reskontro. Bruk for eksempel 3000-3999.");
    return { from: main, to: Number(end) };
  }
  return { from: main, to: main, exact: code.includes(":") ? code : undefined };
}

function truncatedNote(complete: boolean) {
  return complete ? {} : { note: `Viser bare de første ${MAX_PAGES * MAX_PAGE_SIZE} kontoene. Snevre inn med number eller query.` };
}
