import * as z from "zod";
import type { components } from "../fiken/types.gen.ts";
import { kronerSchema, kronerToOre } from "../money.ts";
import { PRODUCT_VAT_TYPES } from "../vat.ts";
import { compact, companyInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { productSummary } from "./summaries.ts";
import { defineTool, jsonResult, REVERSIBLE_WRITE } from "./tool.ts";
import { accountInput, newId } from "./write-common.ts";

type Product = components["schemas"]["product"];

export const saveProduct = defineTool({
  name: "save_product",
  access: "write",
  title: "Opprett eller endre produkt",
  description: "Oppretter eller endrer et produkt. Pris i kroner eks. MVA. Med id: endrer bare feltene du sender.",
  inputSchema: z.object({
    company: companyInput,
    id: fikenId("For å endre").optional(),
    name: z.string().min(1).optional(),
    unit_price: kronerSchema("Eks. MVA").optional(),
    vat_type: z.enum(PRODUCT_VAT_TYPES).optional().describe("Standard HIGH"),
    income_account: accountInput("Standard 3000").optional(),
    product_number: z.string().optional(),
    active: z.boolean().optional(),
  }),
  annotations: REVERSIBLE_WRITE,
  async handler(input, { fiken }) {
    const companySlug = await resolveCompany(fiken, input.company);
    const changes = compact({
      name: input.name,
      unitPrice: input.unit_price === undefined ? undefined : kronerToOre(input.unit_price),
      vatType: input.vat_type,
      incomeAccount: input.income_account,
      productNumber: input.product_number,
      active: input.active,
    }) as Partial<Product>;

    let productId: number;
    let created = false;
    if (input.id !== undefined) {
      const { data: existing } = await fiken.api.GET("/companies/{companySlug}/products/{productId}", {
        params: { path: { companySlug, productId: input.id } },
      });
      if (!existing) throw new ToolError(`Fant ikke produkt ${input.id}.`);
      // PUT replaces the whole product, so every writable field goes back.
      const { name, unitPrice, incomeAccount, vatType, active, productNumber, stock, note } = existing;
      const body = { ...compact({ name, unitPrice, incomeAccount, vatType, active, productNumber, stock, note }), ...changes } as Product;
      await fiken.api.PUT("/companies/{companySlug}/products/{productId}", { params: { path: { companySlug, productId: input.id } }, body });
      productId = input.id;
    } else {
      if (!changes.name) throw new ToolError("Oppgi name for et nytt produkt.");
      const { response } = await fiken.api.POST("/companies/{companySlug}/products", {
        params: { path: { companySlug } },
        body: { incomeAccount: "3000", vatType: "HIGH", active: true, ...changes } as Product,
      });
      productId = newId(response, "at produktet ble opprettet");
      created = true;
    }

    const { data } = await fiken.api.GET("/companies/{companySlug}/products/{productId}", { params: { path: { companySlug, productId } } });
    return jsonResult({ created, product: data ? productSummary(data) : null });
  },
});
