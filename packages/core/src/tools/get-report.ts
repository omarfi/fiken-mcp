import * as z from "zod";
import { MAX_PAGE_SIZE, type FikenClient } from "../fiken/client.ts";
import type { components } from "../fiken/types.gen.ts";
import { oreToKroner } from "../money.ts";
import { checkPeriod, companyInput, dateInput, dayBefore, fetchPages, kr, resolveCompany, ToolError } from "./common.ts";
import { bankCheck, payrollReport, vatReport } from "./derived-reports.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";
import { accountInput } from "./write-common.ts";

type AccountBalance = components["schemas"]["accountBalance"];

const MAX_PAGES = 10;

export const getReport = defineTool({
  name: "get_report",
  access: "read",
  title: "Rapporter",
  description:
    "Oversikter i kroner. Fra kontoene: vat (MVA per termin), payroll (lønn og trekk per måned), bank_check (saldo, duplikater, åpne poster, " +
    "standard 30 dager). Ikke MVA-melding, A-melding eller avstemming. Ved tvil: anbefal regnskapsfører.",
  inputSchema: z.object({
    company: companyInput,
    type: z.enum(["result", "balance", "receivables", "payables", "product_sales", "vat", "payroll", "bank_check"]),
    from: dateInput("Fra og med (ÅÅÅÅ-MM-DD), standard 1. januar").optional(),
    to: dateInput("Til og med, standard i dag").optional(),
    bank_account: accountInput("For bank_check").optional(),
  }),
  annotations: READ_ONLY,
  async handler(input, { fiken, today }) {
    checkPeriod(input.from, input.to);
    const companySlug = await resolveCompany(fiken, input.company);
    const to = input.to ?? today;
    const from = input.from ?? `${to.slice(0, 4)}-01-01`;
    const balances = (date: string, fromAccount: number, toAccount: number) => accountBalances(fiken, companySlug, date, fromAccount, toAccount);

    switch (input.type) {
      case "vat":
        return jsonResult(await vatReport(fiken, companySlug, from, to));
      case "payroll":
        return jsonResult(await payrollReport(fiken, companySlug, from, to));
      case "bank_check":
        return jsonResult(await bankCheck(fiken, companySlug, input.from ?? daysBefore(to, 30), to, input.bank_account));

      case "result": {
        if (from.slice(0, 4) !== to.slice(0, 4)) {
          throw new ToolError("Resultatet regnes innenfor ett kalenderår, fordi Fiken nullstiller resultatkontoene ved årsskiftet. Del perioden opp per år.");
        }
        // Result accounts restart at zero each year, so the balance on a date is the result so far that year.
        const atEnd = await balances(to, 3000, 8799);
        const beforeStart = from.endsWith("-01-01") ? [] : await balances(dayBefore(from), 3000, 8799);
        const movement = difference(atEnd, beforeStart);
        return jsonResult({ type: "result", period: { from, to }, sign: "Inntekter er positive, kostnader negative.", ...resultReport(movement) });
      }

      case "balance": {
        const assetsAndLiabilities = await balances(to, 1000, 2999);
        const resultAccounts = await balances(to, 3000, 8999);
        return jsonResult({ type: "balance", date: to, ...balanceReport(byMainAccount(assetsAndLiabilities), resultAccounts) });
      }

      case "receivables":
      case "payables": {
        const ledger = input.type === "receivables" ? 1500 : 2400;
        const rows = (await balances(to, ledger, ledger))
          .filter((row) => row.code?.includes(":") && row.balance)
          // Receivables are debit (positive) balances, payables credit (negative): show both as amounts owed.
          .map((row) => ({ account: row.code, name: row.name, amount: kr(input.type === "receivables" ? row.balance : -(row.balance ?? 0)) }))
          .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
        return jsonResult({
          type: input.type,
          date: to,
          total: round(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0)),
          [input.type === "receivables" ? "customers" : "suppliers"]: rows,
          note:
            input.type === "receivables"
              ? "Fra kundereskontro (1500). Fakturaene bak: find_invoices status=unpaid."
              : "Fra leverandørreskontro (2400). Kjøpene bak: find_purchases status=unpaid.",
        });
      }

      case "product_sales": {
        const { data } = await fiken.api.POST("/companies/{companySlug}/products/salesReport", {
          params: { path: { companySlug } },
          body: { from, to },
        });
        const line = (info: components["schemas"]["productSalesLineInfo"] | undefined) =>
          info && { count: info.count, net: kr(info.netAmount), vat: kr(info.vatAmount), gross: kr(info.grossAmount) };
        const products = (data ?? []).map((row) => ({
          productId: row.product?.productId,
          name: row.product?.name,
          sold: line(row.sold),
          credited: line(row.credited),
          total: line(row.sum),
        }));
        return jsonResult({ type: "product_sales", period: { from, to }, products });
      }
    }
  },
});

async function accountBalances(fiken: FikenClient, companySlug: string, date: string, fromAccount: number, toAccount: number) {
  const { items, complete } = await fetchPages(
    (page) =>
      fiken.api.GET("/companies/{companySlug}/accountBalances", {
        params: { path: { companySlug }, query: { date, fromAccount, toAccount, page, pageSize: MAX_PAGE_SIZE } },
      }),
    MAX_PAGES,
  );
  if (!complete) throw new ToolError("For mange kontoer til å lage rapporten. Kontakt support.");
  return items;
}

/** Balance at the end minus balance before the start, per account. */
function difference(end: AccountBalance[], start: AccountBalance[]): AccountBalance[] {
  const before = new Map(start.map((row) => [row.code, row.balance ?? 0]));
  const codes = new Set([...end.map((row) => row.code), ...start.map((row) => row.code)]);
  return [...codes].map((code) => {
    const row = end.find((item) => item.code === code) ?? start.find((item) => item.code === code);
    return { code: code ?? "", name: row?.name ?? "", balance: (end.find((item) => item.code === code)?.balance ?? 0) - (before.get(code) ?? 0) };
  });
}

/** Sums sub-ledger accounts (1500:10001) into their main account (1500). */
function byMainAccount(rows: AccountBalance[]): AccountBalance[] {
  const totals = new Map<string, AccountBalance>();
  for (const row of rows) {
    const main = (row.code ?? "").slice(0, 4);
    const existing = totals.get(main);
    totals.set(main, {
      code: main,
      name: row.code?.includes(":") ? (existing?.name ?? "") : (row.name ?? existing?.name ?? ""),
      balance: (existing?.balance ?? 0) + (row.balance ?? 0),
    });
  }
  return [...totals.values()].sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
}

interface Group {
  name: string;
  from: number;
  to: number;
}

const RESULT_GROUPS: Group[] = [
  { name: "Driftsinntekter", from: 3000, to: 3999 },
  { name: "Varekostnad", from: 4000, to: 4999 },
  { name: "Lønnskostnad", from: 5000, to: 5999 },
  { name: "Andre driftskostnader", from: 6000, to: 7999 },
  { name: "Finansposter og skatt", from: 8000, to: 8799 },
];

const ASSET_GROUPS: Group[] = [
  { name: "Anleggsmidler", from: 1000, to: 1399 },
  { name: "Omløpsmidler", from: 1400, to: 1999 },
];

const EQUITY_AND_LIABILITY_GROUPS: Group[] = [
  { name: "Egenkapital", from: 2000, to: 2099 },
  { name: "Langsiktig gjeld", from: 2100, to: 2299 },
  { name: "Kortsiktig gjeld", from: 2300, to: 2999 },
];

/** Groups rows by account range. `factor` flips credit balances so they read as positive amounts. */
function groups(rows: AccountBalance[], definitions: Group[], factor: 1 | -1) {
  return definitions
    .map((group) => {
      const accounts = rows
        .filter((row) => inRange(row.code, group) && row.balance)
        .map((row) => ({ code: row.code, name: row.name, amount: oreToKroner(factor * (row.balance ?? 0)) }));
      return { name: group.name, total: round(accounts.reduce((sum, account) => sum + account.amount, 0)), accounts };
    })
    .filter((group) => group.accounts.length > 0);
}

function resultReport(rows: AccountBalance[]) {
  const sections = groups(rows, RESULT_GROUPS, -1);
  const total = (names: string[]) => round(sections.filter((section) => names.includes(section.name)).reduce((sum, section) => sum + section.total, 0));
  return {
    groups: sections,
    operatingResult: total(RESULT_GROUPS.slice(0, 4).map((group) => group.name)),
    result: total(RESULT_GROUPS.map((group) => group.name)),
  };
}

function balanceReport(rows: AccountBalance[], resultAccounts: AccountBalance[]) {
  const assets = groups(rows, ASSET_GROUPS, 1);
  const equityAndLiabilities = groups(rows, EQUITY_AND_LIABILITY_GROUPS, -1);
  // The year's result sits on the result accounts until the year is closed. It belongs to equity.
  const resultSoFar = oreToKroner(-resultAccounts.reduce((sum, row) => sum + (row.balance ?? 0), 0));
  const totalAssets = round(assets.reduce((sum, group) => sum + group.total, 0));
  const totalEquityAndLiabilities = round(equityAndLiabilities.reduce((sum, group) => sum + group.total, 0) + resultSoFar);
  return {
    assets,
    totalAssets,
    equityAndLiabilities,
    resultNotYetClosed: resultSoFar,
    totalEquityAndLiabilities,
    balanced: Math.abs(totalAssets - totalEquityAndLiabilities) < 0.005,
  };
}

function inRange(code: string | undefined, group: Group): boolean {
  const main = Number((code ?? "").slice(0, 4));
  return main >= group.from && main <= group.to;
}

function daysBefore(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
