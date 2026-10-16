import { describe, expect, it } from "vitest";
import type { FikenHttpRequest } from "../src/fiken/transport.ts";
import { connect, json, MockTransport } from "./helpers.ts";

const COMPANY = "test-as";
const BASE = `/companies/${COMPANY}`;

type Line = { account: string; amount: number };
const entry = (id: number, date: string, type: string, lines: Line[], extra: Record<string, unknown> = {}) => ({
  journalEntryId: id,
  transactionId: id,
  date,
  transactionType: type,
  description: `${type} ${id}`,
  lines,
  ...extra,
});

function fiken(routes: Record<string, unknown>) {
  return new MockTransport((request: FikenHttpRequest) => {
    const path = request.path.split("?")[0] ?? "";
    const route = routes[path];
    return route === undefined ? json([]) : json(typeof route === "function" ? (route as (r: FikenHttpRequest) => unknown)(request) : route);
  });
}

async function report(transport: MockTransport, args: Record<string, unknown>) {
  const client = await connect(transport, { today: () => "2026-10-16" });
  const result = await client.callTool({ name: "get_report", arguments: { company: COMPANY, ...args } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent as Record<string, unknown>;
}

describe("vat", () => {
  const entries = [
    entry(1, "2026-02-10", "Salg", [{ account: "1500:10001", amount: 12500 }, { account: "2701", amount: -2500 }, { account: "3000", amount: -10000 }]),
    entry(2, "2026-02-20", "Kjøp", [{ account: "6800", amount: 4000 }, { account: "2711", amount: 1000 }, { account: "2400:20001", amount: -5000 }]),
    entry(3, "2026-03-05", "Salg", [{ account: "1920:10001", amount: 6250 }, { account: "2701", amount: -1250 }, { account: "3000", amount: -5000 }]),
    // Settlement and annulled entries are not part of a period's VAT.
    entry(4, "2026-03-10", "Mva-oppgjør", [{ account: "2701", amount: 2500 }, { account: "2740", amount: -2500 }]),
    entry(5, "2026-03-11", "Salg", [{ account: "2701", amount: -99900 }, { account: "1920:10001", amount: 99900 }], { offsetTransactionId: 6 }),
    entry(6, "2026-03-12", "Annullering", [{ account: "2701", amount: 99900 }, { account: "1920:10001", amount: -99900 }]),
  ];

  it("splits by bi-monthly termin and leaves out settlement and annulled entries", async () => {
    const result = await report(
      fiken({ [BASE]: { vatType: "bi-monthly" }, [`${BASE}/journalEntries`]: entries, [`${BASE}/accounts`]: [{ code: "2701", name: "Utgående mva, høy sats" }] }),
      { type: "vat", from: "2026-01-01", to: "2026-06-30" },
    );
    expect(result.termins).toEqual([
      expect.objectContaining({ termin: "1. termin 2026", from: "2026-01-01", to: "2026-02-28", outgoing: 25, incoming: 10, toPay: 15 }),
      expect.objectContaining({ termin: "2. termin 2026", from: "2026-03-01", to: "2026-04-30", outgoing: 12.5, incoming: 0, toPay: 12.5 }),
    ]);
  });

  it("uses one period for yearly VAT and refuses a company without VAT", async () => {
    const yearly = await report(fiken({ [BASE]: { vatType: "yearly" }, [`${BASE}/journalEntries`]: entries }), { type: "vat", from: "2026-01-01", to: "2026-12-31" });
    expect(yearly.termins).toEqual([expect.objectContaining({ termin: "2026", outgoing: 37.5, incoming: 10 })]);

    const client = await connect(fiken({ [BASE]: { vatType: "no" } }), { today: () => "2026-10-16" });
    const none = await client.callTool({ name: "get_report", arguments: { company: COMPANY, type: "vat" } });
    expect(JSON.stringify(none.content)).toContain("ikke registrert");
  });
});

describe("payroll", () => {
  it("sums salary, employer's tax and withholding per month, split into accrued and paid", async () => {
    const entries = [
      entry(1, "2026-01-25", "Lønn", [
        { account: "5000", amount: 5000000 },
        { account: "2600", amount: -1500000 },
        { account: "1920:10001", amount: -3500000 },
        { account: "5401", amount: 705000 },
        { account: "2771", amount: -705000 },
      ]),
      entry(2, "2026-03-15", "Betaling av forskuddstrekk", [{ account: "2600", amount: 1500000 }, { account: "1920:10001", amount: -1500000 }]),
    ];
    const result = await report(fiken({ [`${BASE}/journalEntries`]: entries }), { type: "payroll", from: "2026-01-01", to: "2026-03-31" });
    expect(result.months).toEqual([
      { month: "2026-01", salaryCost: 50000, employerTaxCost: 7050, withholdingDeducted: 15000, withholdingPaid: 0, employerTaxAccrued: 7050, employerTaxPaid: 0 },
      { month: "2026-03", salaryCost: 0, employerTaxCost: 0, withholdingDeducted: 0, withholdingPaid: 15000, employerTaxAccrued: 0, employerTaxPaid: 0 },
    ]);
  });
});

describe("bank_check", () => {
  const routes = {
    [`${BASE}/bankAccounts`]: [{ bankAccountId: 1, name: "Drift", accountCode: "1920:10001", type: "normal" }],
    [`${BASE}/accountBalances`]: [{ code: "1920:10001", balance: 150000 }],
    [`${BASE}/bankBalances`]: [{ bankAccountId: 1, date: "2026-10-15", amount: 137500 }],
    [`${BASE}/journalEntries`]: [
      entry(1, "2026-10-01", "Fri", [{ account: "1920:10001", amount: -12500 }, { account: "6800", amount: 12500 }]),
      entry(2, "2026-10-02", "Fri", [{ account: "1920:10001", amount: -12500 }, { account: "6800", amount: 12500 }]),
      entry(3, "2026-10-10", "Fri", [{ account: "1920:10001", amount: 18750 }, { account: "3000", amount: -18750 }]),
    ],
    [`${BASE}/sales`]: [{ saleId: 7, outstandingBalance: 18750, customer: { name: "Kunde AS" }, date: "2026-09-30" }],
    [`${BASE}/purchases`]: [],
  };

  it("shows the difference to the bank, possible duplicates and open items with the same amount", async () => {
    const result = await report(fiken(routes), { type: "bank_check" });
    expect(result.bankAccounts).toEqual([
      expect.objectContaining({
        account: "1920:10001",
        balanceInAccounts: 1500,
        balanceFromBank: 1375,
        difference: 125,
        possibleDuplicates: [{ amount: -125, dates: ["2026-10-02", "2026-10-01"], descriptions: ["Fri 2", "Fri 1"] }],
        openItemsWithSameAmount: [{ kind: "sale", id: 7, amount: 187.5, counterparty: "Kunde AS", date: "2026-09-30" }],
      }),
    ]);
  });

  it("looks at the last 30 days by default", async () => {
    const transport = fiken(routes);
    await report(transport, { type: "bank_check" });
    const scan = transport.requests.find((request) => request.path.includes("/journalEntries"));
    expect(new URL(`https://x${scan?.path ?? ""}`).searchParams.get("dateGe")).toBe("2026-09-16");
  });
});
