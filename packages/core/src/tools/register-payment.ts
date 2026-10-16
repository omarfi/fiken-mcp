import * as z from "zod";
import type { FikenClient } from "../fiken/client.ts";
import { kronerSchema, kronerToOre, oreToKroner } from "../money.ts";
import { companyInput, dateInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { purchaseSummary, saleSummary } from "./summaries.ts";
import { CONFIRM_FIRST, defineTool, DESTRUCTIVE, jsonResult } from "./tool.ts";
import { accountInput } from "./write-common.ts";

export const registerPayment = defineTool({
  name: "register_payment",
  access: "write",
  title: "Registrer betaling",
  description:
    "Registrerer en betaling som har skjedd, på faktura, salg eller kjøp. Flytter ikke penger. Bare for betalinger som ikke kommer " +
    `via bankavstemmingen. ${CONFIRM_FIRST}`,
  inputSchema: z.object({
    company: companyInput,
    target_type: z.enum(["invoice", "sale", "purchase"]),
    target_id: fikenId("ID"),
    date: dateInput("Betalingsdato (ÅÅÅÅ-MM-DD)"),
    amount: kronerSchema("Kroner"),
    account: accountInput("Betalt til eller fra, f.eks. 1920:10001"),
  }),
  annotations: DESTRUCTIVE,
  async handler(input, { fiken }) {
    const companySlug = await resolveCompany(fiken, input.company);
    const amount = kronerToOre(input.amount);
    if (amount <= 0) throw new ToolError("Beløpet må være større enn 0.");
    const payment = { date: input.date, account: input.account, amount };

    if (input.target_type === "purchase") {
      const purchase = await getPurchase(fiken, companySlug, input.target_id);
      if (purchase.paid || purchase.settled) throw new ToolError("Kjøpet er allerede betalt.");
      const gross = (purchase.lines ?? []).reduce((sum, line) => sum + (line.netPrice ?? 0) + (line.vat ?? 0), 0);
      const paid = (purchase.payments ?? []).reduce((sum, earlier) => sum + earlier.amount, 0);
      if (amount > gross - paid) throw new ToolError(`Beløpet er større enn det som gjenstår (${oreToKroner(gross - paid)} kr).`);
      await fiken.api.POST("/companies/{companySlug}/purchases/{purchaseId}/payments", {
        params: { path: { companySlug, purchaseId: input.target_id } },
        body: payment,
      });
      return jsonResult({ registered: true, purchase: purchaseSummary(await getPurchase(fiken, companySlug, input.target_id)) });
    }

    // An invoice is paid through the sale behind it.
    const saleId = input.target_type === "sale" ? input.target_id : await saleOfInvoice(fiken, companySlug, input.target_id);
    const sale = await getSale(fiken, companySlug, saleId);
    if (sale.settled) throw new ToolError(input.target_type === "invoice" ? "Fakturaen er allerede betalt." : "Salget er allerede oppgjort.");
    if (sale.outstandingBalance !== undefined && amount > sale.outstandingBalance) {
      throw new ToolError(`Beløpet er større enn det som gjenstår (${oreToKroner(sale.outstandingBalance)} kr).`);
    }
    await fiken.api.POST("/companies/{companySlug}/sales/{saleId}/payments", { params: { path: { companySlug, saleId } }, body: payment });
    return jsonResult({ registered: true, sale: saleSummary(await getSale(fiken, companySlug, saleId)) });
  },
});

async function saleOfInvoice(fiken: FikenClient, companySlug: string, invoiceId: number): Promise<number> {
  const { data } = await fiken.api.GET("/companies/{companySlug}/invoices/{invoiceId}", { params: { path: { companySlug, invoiceId } } });
  const saleId = data?.sale?.saleId;
  if (saleId === undefined) throw new ToolError(`Fant ikke salget bak faktura ${invoiceId}.`);
  return saleId;
}

async function getSale(fiken: FikenClient, companySlug: string, saleId: number) {
  const { data } = await fiken.api.GET("/companies/{companySlug}/sales/{saleId}", { params: { path: { companySlug, saleId } } });
  if (!data) throw new ToolError(`Fant ikke salg ${saleId}.`);
  return data;
}

async function getPurchase(fiken: FikenClient, companySlug: string, purchaseId: number) {
  const { data } = await fiken.api.GET("/companies/{companySlug}/purchases/{purchaseId}", { params: { path: { companySlug, purchaseId } } });
  if (!data) throw new ToolError(`Fant ikke kjøp ${purchaseId}.`);
  return data;
}
