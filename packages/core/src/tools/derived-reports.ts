import { MAX_PAGE_SIZE, type FikenClient } from "../fiken/client.ts";
import { oreToKroner } from "../money.ts";
import { compact, fetchPages, kr, ToolError } from "./common.ts";

/**
 * Reports Fiken has no endpoint for (VAT return, payroll, bank reconciliation), derived from the
 * accounts. They explain the numbers and point out likely mistakes; they never file or reconcile.
 */

const MAX_PAGES = 10;

interface Posting {
  date: string;
  account: string;
  amount: number;
  type: string;
  description: string;
  transactionId: number | undefined;
}

/** Every posting line in the period, except annulled entries and their counter-entries, which cancel out. */
async function postings(fiken: FikenClient, companySlug: string, from: string, to: string): Promise<{ lines: Posting[]; complete: boolean }> {
  const { items, complete } = await fetchPages(
    (page) =>
      fiken.api.GET("/companies/{companySlug}/journalEntries", {
        params: { path: { companySlug }, query: { dateGe: from, dateLe: to, page, pageSize: MAX_PAGE_SIZE } },
      }),
    MAX_PAGES,
  );
  const lines = items
    .filter((entry) => entry.offsetTransactionId === undefined && entry.transactionType !== "Annullering")
    .flatMap((entry) =>
      entry.lines.map((line) => ({
        date: entry.date,
        account: line.account ?? "",
        amount: line.amount,
        type: entry.transactionType ?? "",
        description: entry.description,
        transactionId: entry.transactionId,
      })),
    );
  return { lines, complete };
}

const main = (account: string) => Number(account.slice(0, 4));
const sum = (lines: Posting[]) => lines.reduce((total, line) => total + line.amount, 0);
/** Negates without producing -0, which reads oddly in a report. */
const negate = (value: number) => (value === 0 ? 0 : -value);
const truncated = (complete: boolean) =>
  complete ? {} : { warning: `Perioden har flere enn ${MAX_PAGES * MAX_PAGE_SIZE} bilag, og bare de første er tatt med. Velg en kortere periode.` };

// VAT

const TERMIN_MONTHS: Record<string, number> = { "bi-monthly": 2, monthly: 1, yearly: 12 };

export async function vatReport(fiken: FikenClient, companySlug: string, from: string, to: string) {
  const { data: company } = await fiken.api.GET("/companies/{companySlug}", { params: { path: { companySlug } } });
  const vatType = company?.vatType ?? "no";
  if (vatType === "no") throw new ToolError("Foretaket er ikke registrert i Merverdiavgiftsregisteret i Fiken.");

  const { data: accounts } = await fiken.api.GET("/companies/{companySlug}/accounts", {
    params: { path: { companySlug }, query: { fromAccount: 2700, toAccount: 2769, pageSize: MAX_PAGE_SIZE } },
  });
  const names = new Map((accounts ?? []).map((account) => [account.code, account.name]));
  const { lines, complete } = await postings(fiken, companySlug, from, to);
  // VAT settlement moves the balances to 2740 and is not part of a period's VAT.
  const vat = lines.filter((line) => main(line.account) >= 2700 && main(line.account) <= 2719 && line.type !== "Mva-oppgjør");

  const termins = terminsIn(from, to, TERMIN_MONTHS[vatType] ?? 12).map((termin) => {
    const inTermin = vat.filter((line) => line.date >= termin.from && line.date <= termin.to);
    const outgoing = negate(sum(inTermin.filter((line) => main(line.account) <= 2709)));
    const incoming = sum(inTermin.filter((line) => main(line.account) >= 2710));
    const accountsUsed = [...new Set(inTermin.map((line) => line.account))].sort().map((code) => ({
      code,
      name: names.get(code),
      amount: oreToKroner(sum(inTermin.filter((line) => line.account === code))),
    }));
    return { ...termin, outgoing: oreToKroner(outgoing), incoming: oreToKroner(incoming), toPay: oreToKroner(outgoing - incoming), accounts: accountsUsed };
  });

  return {
    type: "vat",
    vatType,
    period: { from, to },
    termins: termins.filter((termin) => termin.accounts.length > 0),
    note: "Beregnet fra MVA-kontoene 2700–2719 (utgående positiv, inngående fradrag). Dette er ikke MVA-meldingen. Kontroller mot MVA-meldingen i Fiken før innsending. Regler: https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/",
    ...truncated(complete),
  };
}

/** The VAT periods that overlap [from, to], numbered as in the VAT return ("5. termin"). */
function terminsIn(from: string, to: string, months: number) {
  const result: { termin: string; from: string; to: string }[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    for (let start = 1; start <= 12; start += months) {
      const termin = { termin: months === 12 ? `${year}` : `${(start - 1) / months + 1}. termin ${year}`, from: date(year, start, 1), to: endOfMonth(year, start + months - 1) };
      if (termin.to >= from && termin.from <= to) result.push(termin);
    }
  }
  return result;
}

// Payroll

const PAYROLL = {
  salary: [5000, 5399],
  employerTax: [5400, 5499],
  withholding: [2600, 2699],
  employerTaxPayable: [2770, 2789],
} as const;

export async function payrollReport(fiken: FikenClient, companySlug: string, from: string, to: string) {
  const { lines, complete } = await postings(fiken, companySlug, from, to);
  const within = (range: readonly [number, number]) => (line: Posting) => main(line.account) >= range[0] && main(line.account) <= range[1];

  const months = monthsIn(from, to)
    .map((month) => {
      const inMonth = lines.filter((line) => line.date >= month.from && line.date <= month.to);
      const withholding = inMonth.filter(within(PAYROLL.withholding));
      const employerTaxPayable = inMonth.filter(within(PAYROLL.employerTaxPayable));
      return compact({
        month: month.from.slice(0, 7),
        salaryCost: oreToKroner(sum(inMonth.filter(within(PAYROLL.salary)))),
        employerTaxCost: oreToKroner(sum(inMonth.filter(within(PAYROLL.employerTax)))),
        // Credits on 26xx are tax withheld from salaries; debits are payments to the tax office.
        withholdingDeducted: oreToKroner(negate(sum(withholding.filter((line) => line.amount < 0)))),
        withholdingPaid: oreToKroner(sum(withholding.filter((line) => line.amount > 0))),
        employerTaxAccrued: oreToKroner(negate(sum(employerTaxPayable.filter((line) => line.amount < 0)))),
        employerTaxPaid: oreToKroner(sum(employerTaxPayable.filter((line) => line.amount > 0))),
      });
    })
    .filter((month) => Object.values(month).some((value) => typeof value === "number" && value !== 0));

  return {
    type: "payroll",
    period: { from, to },
    months,
    note:
      (months.length === 0 ? "Ingen lønnsposteringer i perioden. " : "") +
      "Fra kontoene 5000–5499 (lønn og arbeidsgiveravgift), 2600–2699 (trekk) og 2770–2789 (skyldig arbeidsgiveravgift). " +
      "A-meldingen leveres fra lønnssystemet; dette er tallene i regnskapet. Regler: https://www.skatteetaten.no/bedrift-og-organisasjon/arbeidsgiver/a-meldingen/",
    ...truncated(complete),
  };
}

function monthsIn(from: string, to: string) {
  const result: { from: string; to: string }[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  while (date(year, month, 1) <= to) {
    result.push({ from: date(year, month, 1), to: endOfMonth(year, month) });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return result;
}

// Bank

const DUPLICATE_DAYS = 3;

export async function bankCheck(fiken: FikenClient, companySlug: string, from: string, to: string, bankAccount: string | undefined) {
  const path = { companySlug };
  const { data: accounts } = await fiken.api.GET("/companies/{companySlug}/bankAccounts", { params: { path, query: { inactive: false, pageSize: MAX_PAGE_SIZE } } });
  const selected = (accounts ?? []).filter((account) => !bankAccount || account.accountCode === bankAccount);
  if (selected.length === 0) throw new ToolError(bankAccount ? `Fant ingen aktiv bankkonto ${bankAccount}.` : "Foretaket har ingen aktive bankkontoer i Fiken.");

  const { data: ledger } = await fiken.api.GET("/companies/{companySlug}/accountBalances", {
    params: { path, query: { date: to, fromAccount: 1900, toAccount: 1999, pageSize: MAX_PAGE_SIZE } },
  });
  const { data: bank } = await fiken.api.GET("/companies/{companySlug}/bankBalances", { params: { path, query: { date: to, pageSize: MAX_PAGE_SIZE } } });
  const { lines, complete } = await postings(fiken, companySlug, from, to);
  const open = await openItems(fiken, companySlug);

  const report = selected.map((account) => {
    const code = account.accountCode ?? "";
    const onAccount = lines.filter((line) => line.account === code).sort((a, b) => b.date.localeCompare(a.date));
    const inAccounts = ledger?.find((row) => row.code === code)?.balance ?? 0;
    const fromBank = bank?.find((row) => row.bankAccountId === account.bankAccountId);
    return compact({
      account: code,
      name: account.name,
      balanceInAccounts: oreToKroner(inAccounts),
      balanceFromBank: kr(fromBank?.amount),
      difference: fromBank?.amount === undefined ? undefined : oreToKroner(inAccounts - fromBank.amount),
      reconciledBalance: kr(account.reconciledBalance),
      reconciledDate: account.reconciledDate,
      postings: onAccount.slice(0, 30).map((line) => ({ date: line.date, amount: oreToKroner(line.amount), type: line.type, description: line.description })),
      morePostings: onAccount.length > 30 ? onAccount.length - 30 : undefined,
      possibleDuplicates: duplicates(onAccount),
      openItemsWithSameAmount: matches(onAccount, open),
    });
  });

  return {
    type: "bank_check",
    period: { from, to },
    bankAccounts: report,
    note:
      "Avstemmer ikke. difference er saldo i regnskapet minus saldo fra banken. Mulige duplikater og åpne poster med samme beløp er hint, ikke feil. " +
      "Avstemming gjøres i Fiken: https://hjelp.fiken.no",
    ...truncated(complete),
  };
}

/** Postings with the same amount within a few days of each other. */
function duplicates(lines: Posting[]) {
  const found: { amount: number; dates: string[]; descriptions: string[] }[] = [];
  const seen = new Set<Posting>();
  for (const line of lines) {
    if (seen.has(line)) continue;
    const twins = lines.filter((other) => other !== line && other.amount === line.amount && Math.abs(days(other.date) - days(line.date)) <= DUPLICATE_DAYS);
    if (twins.length === 0) continue;
    for (const twin of [line, ...twins]) seen.add(twin);
    found.push({ amount: oreToKroner(line.amount), dates: [line, ...twins].map((t) => t.date), descriptions: [line, ...twins].map((t) => t.description) });
  }
  return found.length ? found : undefined;
}

interface OpenItem {
  kind: "sale" | "purchase";
  id: number | undefined;
  amount: number;
  counterparty: string | undefined;
  date: string | undefined;
}

/** Unpaid sales and purchases: a bank posting with the same amount may be a payment booked without linking it. */
async function openItems(fiken: FikenClient, companySlug: string): Promise<OpenItem[]> {
  const path = { companySlug };
  const { data: sales } = await fiken.api.GET("/companies/{companySlug}/sales", { params: { path, query: { settled: false, pageSize: MAX_PAGE_SIZE } } });
  const { data: purchases } = await fiken.api.GET("/companies/{companySlug}/purchases", { params: { path, query: { paid: false, pageSize: MAX_PAGE_SIZE } } });
  return [
    ...(sales ?? [])
      .filter((sale) => !sale.deleted && (sale.outstandingBalance ?? 0) > 0)
      .map((sale) => ({ kind: "sale" as const, id: sale.saleId, amount: sale.outstandingBalance ?? 0, counterparty: sale.customer?.name, date: sale.date })),
    ...(purchases ?? [])
      .filter((purchase) => !purchase.deleted)
      .map((purchase) => ({
        kind: "purchase" as const,
        id: purchase.purchaseId,
        amount: (purchase.lines ?? []).reduce((total, line) => total + (line.netPrice ?? 0) + (line.vat ?? 0), 0),
        counterparty: purchase.supplier?.name,
        date: purchase.date,
      })),
  ];
}

function matches(lines: Posting[], open: OpenItem[]) {
  // Money in matches a sale, money out a purchase.
  const found = open.filter((item) => lines.some((line) => (item.kind === "sale" ? line.amount : -line.amount) === item.amount));
  return found.length ? found.map((item) => ({ ...item, amount: oreToKroner(item.amount) })) : undefined;
}

// Dates

function date(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function endOfMonth(year: number, month: number): string {
  return date(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
}

function days(value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000;
}

