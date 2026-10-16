import * as z from "zod";
import { checkPeriod, companyInput, dateInput, fikenId, idInput, limitInput, newestFirst, pageInput, paging, resolveCompany } from "./common.ts";
import { draftDetail, draftSummary, saleDetail, saleSummary } from "./summaries.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";

export const findSales = defineTool({
  name: "find_sales",
  access: "read",
  title: "Finn salg",
  description:
    "Salg i kroner, nyeste først: kontant, Vipps, nettbutikk og salg bak fakturaer. status: draft, unsettled (ikke oppgjort), settled, all. " +
    "Med id: linjer og betalinger (utkast: id med status=draft).",
  inputSchema: z.object({
    company: companyInput,
    status: z.enum(["draft", "unsettled", "settled", "all"]).default("all"),
    id: idInput("Salgs- eller utkast"),
    customer_id: fikenId("Kontakt-ID fra find_contacts").optional(),
    from: dateInput("Salgsdato fra og med (ÅÅÅÅ-MM-DD)").optional(),
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
        const { data } = await fiken.api.GET("/companies/{companySlug}/sales/drafts/{draftId}", {
          params: { path: { companySlug, draftId: input.id } },
        });
        return jsonResult({ draft: data ? draftDetail(data) : null });
      }
      const { data } = await fiken.api.GET("/companies/{companySlug}/sales/{saleId}", {
        params: { path: { companySlug, saleId: input.id } },
      });
      return jsonResult({ sale: data ? saleDetail(data) : null });
    }

    if (draft) {
      const { data, response } = await fiken.api.GET("/companies/{companySlug}/sales/drafts", {
        params: { path: { companySlug }, query: { page: input.page, pageSize: input.limit } },
      });
      const drafts = (data ?? [])
        .filter((item) => input.customer_id === undefined || item.contact?.contactId === input.customer_id)
        .map(draftSummary);
      return jsonResult({ drafts, paging: paging(input.page, input.limit, data?.length ?? 0, response) });
    }

    // Fiken lists sales oldest first with no way to sort, so newestFirst turns the pages around.
    const filters = {
      settled: input.status === "settled" ? true : input.status === "unsettled" ? false : undefined,
      contactId: input.customer_id,
      dateGe: input.from,
      dateLe: input.to,
    };
    const { items, paging: pages } = await newestFirst(
      (page, pageSize) => fiken.api.GET("/companies/{companySlug}/sales", { params: { path: { companySlug }, query: { page, pageSize, ...filters } } }),
      input.page,
      input.limit,
    );
    const sales = items.filter((sale) => !sale.deleted).map(saleSummary);
    return jsonResult({ sales, paging: pages });
  },
});
