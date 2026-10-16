import * as z from "zod";
import { MAX_PAGE_SIZE } from "../fiken/client.ts";
import { companyInput, fetchPages, idInput, limitInput, pageInput, pageLocally, paging, resolveCompany } from "./common.ts";
import { productSummary } from "./summaries.ts";
import { defineTool, jsonResult, READ_ONLY } from "./tool.ts";

/** Fiken's name filter on products is exact match only (measured), so a search reads them all and filters here. */
const MAX_SEARCH_PAGES = 5;

export const findProducts = defineTool({
  name: "find_products",
  access: "read",
  title: "Finn produkter",
  description: "Produkter med pris i kroner, MVA-type og inntektskonto.",
  inputSchema: z.object({
    company: companyInput,
    id: idInput("Produkt"),
    query: z.string().min(1).optional().describe("Del av navn eller produktnummer"),
    include_inactive: z.boolean().default(false),
    limit: limitInput,
    page: pageInput,
  }),
  annotations: READ_ONLY,
  async handler(input, { fiken }) {
    const companySlug = await resolveCompany(fiken, input.company);

    if (input.id !== undefined) {
      const { data } = await fiken.api.GET("/companies/{companySlug}/products/{productId}", {
        params: { path: { companySlug, productId: input.id } },
      });
      return jsonResult({ product: data ? { ...productSummary(data), note: data.note } : null });
    }

    const active = input.include_inactive ? undefined : true;

    if (input.query) {
      const needle = input.query.toLowerCase();
      const { items, complete } = await fetchPages(
        (page) =>
          fiken.api.GET("/companies/{companySlug}/products", {
            params: { path: { companySlug }, query: { page, pageSize: MAX_PAGE_SIZE, active } },
          }),
        MAX_SEARCH_PAGES,
      );
      const matches = items
        .filter((product) => `${product.name} ${product.productNumber ?? ""}`.toLowerCase().includes(needle))
        .map(productSummary);
      const { items: products, paging: localPaging } = pageLocally(matches, input.page, input.limit);
      return jsonResult({
        products,
        paging: localPaging,
        ...(complete ? {} : { note: `Søket gikk gjennom de første ${MAX_SEARCH_PAGES * MAX_PAGE_SIZE} produktene.` }),
      });
    }

    const { data, response } = await fiken.api.GET("/companies/{companySlug}/products", {
      params: { path: { companySlug }, query: { page: input.page, pageSize: input.limit, active } },
    });
    const products = (data ?? []).map(productSummary);
    return jsonResult({ products, paging: paging(input.page, input.limit, products.length, response) });
  },
});
