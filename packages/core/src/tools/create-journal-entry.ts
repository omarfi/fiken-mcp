import * as z from "zod";
import { FikenApiError } from "../fiken/errors.ts";
import type { components } from "../fiken/types.gen.ts";
import { kronerSchema, kronerToOre } from "../money.ts";
import { companyInput, compact, dateInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { journalEntrySummary } from "./summaries.ts";
import { CONFIRM_FIRST, defineTool, DESTRUCTIVE, jsonResult } from "./tool.ts";
import { accountInput, newId } from "./write-common.ts";

/** Fiken's VAT codes (spec: "VAT Code"). */
const VAT_CODES = new Set([0, 1, 3, 5, 6, 7, 11, 12, 13, 14, 15, 21, 22, 23, 31, 32, 33, 51, 52, 86, 87, 88, 89, 91, 92]);
/** Fiken prefixes the description with "Fri postering registrert via API: " within 200 characters. */
const MAX_DESCRIPTION = 160;

export const createJournalEntry = defineTool({
  name: "create_journal_entry",
  access: "write",
  title: "Før manuelt bilag",
  description:
    "Manuelt bilag. Linjer med debet- og/eller kreditkonto og beløp i kroner. Sjekker balanse, kontoer og MVA-koder. " +
    `Bokføres med en gang. Konto: https://kontohjelp.fiken.no. ${CONFIRM_FIRST}`,
  inputSchema: z.object({
    company: companyInput,
    date: dateInput("ÅÅÅÅ-MM-DD"),
    description: z.string().min(1).max(MAX_DESCRIPTION),
    lines: z
      .array(
        z.object({
          debit: accountInput("Debetkonto").optional(),
          credit: accountInput("Kreditkonto").optional(),
          amount: kronerSchema("Kroner"),
          debit_vat_code: z.number().int().optional(),
          credit_vat_code: z.number().int().optional(),
          project_id: fikenId("Prosjekt").optional(),
        }),
      )
      .min(1),
  }),
  annotations: DESTRUCTIVE,
  async handler(input, { fiken }) {
    const companySlug = await resolveCompany(fiken, input.company);

    // A line with both accounts balances itself; one-sided lines must balance each other.
    let debit = 0;
    let credit = 0;
    for (const [index, line] of input.lines.entries()) {
      if (!line.debit && !line.credit) throw new ToolError(`Linje ${index + 1} mangler både debet- og kreditkonto.`);
      if (kronerToOre(line.amount) <= 0) throw new ToolError(`Linje ${index + 1} må ha et positivt beløp.`);
      for (const code of [line.debit_vat_code, line.credit_vat_code]) {
        if (code !== undefined && !VAT_CODES.has(code)) throw new ToolError(`MVA-kode ${code} på linje ${index + 1} finnes ikke i Fiken.`);
      }
      if (line.debit && !line.credit) debit += kronerToOre(line.amount);
      if (line.credit && !line.debit) credit += kronerToOre(line.amount);
    }
    if (debit !== credit) throw new ToolError(`Debet (${debit / 100} kr) er ikke lik kredit (${credit / 100} kr).`);

    const accounts = new Set(input.lines.flatMap((line) => [line.debit, line.credit]).filter((code): code is string => Boolean(code)));
    for (const accountCode of accounts) {
      try {
        await fiken.api.GET("/companies/{companySlug}/accounts/{accountCode}", { params: { path: { companySlug, accountCode } } });
      } catch (error) {
        if (error instanceof FikenApiError && error.status === 404) {
          throw new ToolError(`Kontoen ${accountCode} finnes ikke i kontoplanen. Se find_accounts eller https://kontohjelp.fiken.no.`);
        }
        throw error;
      }
    }

    // Never "open": an open entry cannot be annulled through the API (measured 16.10.2026).
    const { response } = await fiken.api.POST("/companies/{companySlug}/generalJournalEntries", {
      params: { path: { companySlug } },
      body: {
        description: input.description,
        open: false,
        journalEntries: [
          {
            description: input.description,
            date: input.date,
            lines: input.lines.map(
              (line) =>
                compact({
                  amount: kronerToOre(line.amount),
                  debitAccount: line.debit,
                  creditAccount: line.credit,
                  debitVatCode: line.debit_vat_code,
                  creditVatCode: line.credit_vat_code,
                  projectId: line.project_id,
                }) as components["schemas"]["journalEntryLine"],
            ),
          },
        ],
      },
    });
    // Location points at the transaction, not the entry (measured).
    const transactionId = newId(response, "at bilaget ble ført");
    const { data } = await fiken.api.GET("/companies/{companySlug}/transactions/{transactionId}", {
      params: { path: { companySlug, transactionId } },
    });
    return jsonResult({ booked: true, transactionId, entries: data?.entries?.map(journalEntrySummary) ?? [] });
  },
});
