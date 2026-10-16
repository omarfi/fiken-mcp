import * as z from "zod";
import { checkPeriod, companyInput, fikenId, dateInput, idInput, limitInput, pageInput, paging, resolveCompany } from "./common.ts";
import { draftDetail, draftSummary, purchaseDetail, purchaseSummary } from "./summaries.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";

export const findPurchases = defineTool({
  name: "find_purchases",
  access: "read",
  title: "Finn kjøp",
  description:
    "Kjøp og kostnader i kroner, nyeste først. status: draft, unpaid, paid, all. " +
    "Med id: linjer, betalinger og vedlegg (utkast: id med status=draft). Utestående per leverandør: get_report payables.",
  inputSchema: z.object({
    company: companyInput,
    status: z.enum(["draft", "unpaid", "paid", "all"]).default("all"),
    id: idInput("Kjøps- eller utkast"),
    supplier_id: fikenId("Kontakt-ID fra find_contacts").optional(),
    from: dateInput("Kjøpsdato fra og med (ÅÅÅÅ-MM-DD)").optional(),
    to: dateInput("Til og med").optional(),
    limit: limitInput,
    page: pageInput,
  }),
  annotations: READ_ONLY,
  async handler(input, { fiken }) {
    checkPeriod(input.from, input.to);
    const companySlug = await resolveCompany(fiken, input.company);
    const draft = input.status === "draft";

    if (input.id !== undefined) {
      if (draft) {
        const { data } = await fiken.api.GET("/companies/{companySlug}/purchases/drafts/{draftId}", {
          params: { path: { companySlug, draftId: input.id } },
        });
        return jsonResult({ draft: data ? draftDetail(data) : null });
      }
      const { data } = await fiken.api.GET("/companies/{companySlug}/purchases/{purchaseId}", {
        params: { path: { companySlug, purchaseId: input.id } },
      });
      return jsonResult({ purchase: data ? purchaseDetail(data) : null });
    }

    if (draft) {
      const { data, response } = await fiken.api.GET("/companies/{companySlug}/purchases/drafts", {
        params: { path: { companySlug }, query: { page: input.page, pageSize: input.limit } },
      });
      const drafts = (data ?? [])
        .filter((item) => input.supplier_id === undefined || item.contact?.contactId === input.supplier_id)
        .map(draftSummary);
      return jsonResult({ drafts, paging: paging(input.page, input.limit, data?.length ?? 0, response) });
    }

    const { data, response } = await fiken.api.GET("/companies/{companySlug}/purchases", {
      params: {
        path: { companySlug },
        query: {
          page: input.page,
          pageSize: input.limit,
          sortBy: "date desc",
          paid: input.status === "paid" ? true : input.status === "unpaid" ? false : undefined,
          contactId: input.supplier_id,
          dateGe: input.from,
          dateLe: input.to,
        },
      },
    });
    const purchases = (data ?? []).filter((purchase) => !purchase.deleted).map(purchaseSummary);
    return jsonResult({ purchases, paging: paging(input.page, input.limit, data?.length ?? 0, response) });
  },
});
