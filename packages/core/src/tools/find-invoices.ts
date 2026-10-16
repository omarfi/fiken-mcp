import * as z from "zod";
import { checkPeriod, companyInput, dateInput, fikenId, idInput, limitInput, newestFirst, pageInput, paging, resolveCompany, ToolError } from "./common.ts";
import {
  creditNoteDetail,
  creditNoteSummary,
  invoiceDetail,
  invoiceishDraftDetail,
  invoiceishDraftSummary,
  invoiceSummary,
} from "./summaries.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";

export const findInvoices = defineTool({
  name: "find_invoices",
  access: "read",
  title: "Finn fakturaer og kreditnotaer",
  description:
    "Fakturaer og kreditnotaer, nyeste først, i kroner. status: draft, unpaid, overdue, paid, all. " +
    "Med id: linjer, betalinger og PDF (utkast: id med status=draft). Utestående per kunde: get_report receivables.",
  inputSchema: z.object({
    company: companyInput,
    type: z.enum(["invoice", "credit_note"]).default("invoice"),
    status: z.enum(["draft", "unpaid", "overdue", "paid", "all"]).default("all"),
    id: idInput("Faktura-, kreditnota- eller utkast"),
    customer_id: fikenId("Kontakt-ID fra find_contacts").optional(),
    from: dateInput("Fakturadato fra og med (ÅÅÅÅ-MM-DD)").optional(),
    to: dateInput("Til og med").optional(),
    limit: limitInput,
    page: pageInput,
  }),
  annotations: READ_ONLY,
  async handler(input, { fiken, today }) {
    checkPeriod(input.from, input.to);
    const companySlug = await resolveCompany(fiken, input.company);
    const draft = input.status === "draft";
    const pageQuery = { page: input.page, pageSize: input.limit };

    if (input.type === "credit_note" && input.status === "overdue") {
      throw new ToolError("status=overdue gjelder bare fakturaer. Bruk unpaid for kreditnotaer.");
    }

    if (input.id !== undefined) {
      if (input.type === "invoice" && draft) {
        const { data } = await fiken.api.GET("/companies/{companySlug}/invoices/drafts/{draftId}", {
          params: { path: { companySlug, draftId: input.id } },
        });
        return jsonResult({ draft: data ? invoiceishDraftDetail(data) : null });
      }
      if (input.type === "credit_note" && draft) {
        const { data } = await fiken.api.GET("/companies/{companySlug}/creditNotes/drafts/{draftId}", {
          params: { path: { companySlug, draftId: input.id } },
        });
        return jsonResult({ draft: data ? invoiceishDraftDetail(data) : null });
      }
      if (input.type === "invoice") {
        const { data } = await fiken.api.GET("/companies/{companySlug}/invoices/{invoiceId}", {
          params: { path: { companySlug, invoiceId: input.id } },
        });
        return jsonResult({ invoice: data ? invoiceDetail(data) : null });
      }
      const { data } = await fiken.api.GET("/companies/{companySlug}/creditNotes/{creditNoteId}", {
        params: { path: { companySlug, creditNoteId: String(input.id) } },
      });
      return jsonResult({ creditNote: data ? creditNoteDetail(data) : null });
    }

    if (draft) {
      // Fiken does not filter drafts, so customer and dates are filtered here.
      const path = { companySlug };
      const { data, response } =
        input.type === "invoice"
          ? await fiken.api.GET("/companies/{companySlug}/invoices/drafts", { params: { path, query: pageQuery } })
          : await fiken.api.GET("/companies/{companySlug}/creditNotes/drafts", { params: { path, query: pageQuery } });
      const drafts = (data ?? [])
        .filter((item) => input.customer_id === undefined || item.customers?.some((c) => c.contactId === input.customer_id))
        .filter((item) => (!input.from || (item.issueDate ?? "") >= input.from) && (!input.to || (item.issueDate ?? "") <= input.to))
        .map(invoiceishDraftSummary);
      return jsonResult({ drafts, paging: paging(input.page, input.limit, data?.length ?? 0, response) });
    }

    const settled = input.status === "paid" ? true : input.status === "unpaid" || input.status === "overdue" ? false : undefined;
    const filters = { settled, customerId: input.customer_id, issueDateGe: input.from, issueDateLe: input.to };

    // Fiken lists these oldest first with no way to sort, so newestFirst turns the pages around.
    if (input.type === "invoice") {
      const dueDateLt = input.status === "overdue" ? today : undefined;
      const { items, paging: pages } = await newestFirst(
        (page, pageSize) =>
          fiken.api.GET("/companies/{companySlug}/invoices", {
            params: { path: { companySlug }, query: { page, pageSize, ...filters, dueDateLt } },
          }),
        input.page,
        input.limit,
      );
      const invoices = items.map(invoiceSummary);
      return jsonResult({ invoices, sumGross: sumOf(invoices), paging: pages });
    }

    const { items, paging: pages } = await newestFirst(
      (page, pageSize) =>
        fiken.api.GET("/companies/{companySlug}/creditNotes", { params: { path: { companySlug }, query: { page, pageSize, ...filters } } }),
      input.page,
      input.limit,
    );
    const creditNotes = items.map(creditNoteSummary);
    return jsonResult({ creditNotes, sumGross: sumOf(creditNotes), paging: pages });
  },
});

/** Sum of gross amounts on this page, rounded to øre. */
function sumOf(items: { gross?: number | undefined }[]): number {
  return Math.round(items.reduce((sum, item) => sum + (item.gross ?? 0), 0) * 100) / 100;
}
