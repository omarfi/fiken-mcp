import * as z from "zod";
import { MAX_PAGE_SIZE } from "../fiken/client.ts";
import {
  checkPeriod,
  companyInput,
  fikenId,
  compact,
  dateInput,
  fetchPages,
  idInput,
  limitInput,
  pageInput,
  pageLocally,
  paging,
  resolveCompany,
} from "./common.ts";
import { attachmentSummary, journalEntrySummary } from "./summaries.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";

/** Fiken cannot filter journal entries by account, so an account search scans the period. */
const MAX_SCAN_PAGES = 10;

export const findJournalEntries = defineTool({
  name: "find_journal_entries",
  access: "read",
  title: "Finn bilag og posteringer",
  description:
    "Bilag og posteringer i kroner, positivt er debet. Med account: bilag som posterer på kontoen (standard hittil i år). " +
    "Med id eller transaction_id: detalj med vedlegg.",
  inputSchema: z.object({
    company: companyInput,
    id: idInput("Bilags"),
    transaction_id: fikenId("Transaksjons-ID, f.eks. fra et kjøp").optional(),
    from: dateInput("Bilagsdato fra og med (ÅÅÅÅ-MM-DD)").optional(),
    to: dateInput("Til og med").optional(),
    account: z
      .string()
      .refine((value) => /^\d{4}(:\d{5})?$/.test(value), "Kontonummer som 1920 eller 1500:10001")
      .optional()
      .describe("Konto (1920) eller reskontro (1500:10001). 1500 tar med alle kunder."),
    limit: limitInput,
    page: pageInput,
  }),
  annotations: READ_ONLY,
  async handler(input, { fiken, today }) {
    checkPeriod(input.from, input.to);
    const companySlug = await resolveCompany(fiken, input.company);

    if (input.id !== undefined) {
      const { data } = await fiken.api.GET("/companies/{companySlug}/journalEntries/{journalEntryId}", {
        params: { path: { companySlug, journalEntryId: input.id } },
      });
      return jsonResult({ journalEntry: data ? { ...journalEntrySummary(data), attachments: data.attachments?.map(attachmentSummary) } : null });
    }

    if (input.transaction_id !== undefined) {
      const { data } = await fiken.api.GET("/companies/{companySlug}/transactions/{transactionId}", {
        params: { path: { companySlug, transactionId: input.transaction_id } },
      });
      return jsonResult({
        transaction: data
          ? compact({
              id: data.transactionId,
              type: data.type,
              description: data.description,
              deleted: data.deleted || undefined,
              entries: data.entries?.map((entry) => ({ ...journalEntrySummary(entry), attachments: entry.attachments?.map(attachmentSummary) })),
            })
          : null,
      });
    }

    if (input.account) {
      const account = input.account;
      const from = input.from ?? `${(input.to ?? today).slice(0, 4)}-01-01`;
      const to = input.to ?? today;
      const { items, complete } = await fetchPages(
        (page) =>
          fiken.api.GET("/companies/{companySlug}/journalEntries", {
            params: { path: { companySlug }, query: { dateGe: from, dateLe: to, page, pageSize: MAX_PAGE_SIZE } },
          }),
        MAX_SCAN_PAGES,
      );
      const postsTo = (code: string | undefined) => code === account || (!account.includes(":") && code?.startsWith(`${account}:`));
      const matches = items.filter((entry) => entry.lines.some((line) => postsTo(line.account))).map(journalEntrySummary);
      return jsonResult({
        account,
        period: { from, to },
        ...pageLocally(matches, input.page, input.limit),
        ...(complete
          ? {}
          : { note: `Perioden har flere enn ${MAX_SCAN_PAGES * MAX_PAGE_SIZE} bilag, og bare de første ble søkt gjennom. Velg en kortere periode.` }),
      });
    }

    const { data, response } = await fiken.api.GET("/companies/{companySlug}/journalEntries", {
      params: { path: { companySlug }, query: { dateGe: input.from, dateLe: input.to, page: input.page, pageSize: input.limit } },
    });
    const journalEntries = (data ?? []).map(journalEntrySummary);
    return jsonResult({ journalEntries, paging: paging(input.page, input.limit, journalEntries.length, response) });
  },
});
