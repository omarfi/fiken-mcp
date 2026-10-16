import * as z from "zod";
import type { FikenClient } from "../fiken/client.ts";
import { companyInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { creditNoteSummary, invoiceSummary, purchaseSummary, saleSummary } from "./summaries.ts";
import { CONFIRM_FIRST, defineTool, DESTRUCTIVE, jsonResult } from "./tool.ts";
import { newId } from "./write-common.ts";

export const DRAFT_TYPES = ["invoice", "credit_note", "offer", "purchase", "sale"] as const;
export type DraftKind = (typeof DRAFT_TYPES)[number];

export const finalizeDraft = defineTool({
  name: "finalize_draft",
  access: "write",
  title: "Gjør utkast endelig",
  description:
    `Gjør et utkast til faktura, kreditnota, tilbud, kjøp eller salg. Alt unntatt tilbud bokføres, og kan bare krediteres eller annulleres etterpå. ${CONFIRM_FIRST}`,
  inputSchema: z.object({ company: companyInput, type: z.enum(DRAFT_TYPES), id: fikenId("Utkast-ID") }),
  annotations: DESTRUCTIVE,
  async handler(input, { fiken }) {
    const companySlug = await resolveCompany(fiken, input.company);
    const params = { path: { companySlug, draftId: input.id } };
    if (input.type === "invoice") {
      // Fiken answers 500, not a validation error, for an invoice draft without a bank account (measured).
      const { data: draft } = await fiken.api.GET("/companies/{companySlug}/invoices/drafts/{draftId}", { params });
      if (!draft?.bankAccountNumber) {
        throw new ToolError("Fakturautkastet mangler bankkonto. Lagre det på nytt med save_invoice_draft og id, så legges foretakets bankkonto til.");
      }
    }
    const { response } = await (
      {
        invoice: () => fiken.api.POST("/companies/{companySlug}/invoices/drafts/{draftId}/createInvoice", { params }),
        credit_note: () => fiken.api.POST("/companies/{companySlug}/creditNotes/drafts/{draftId}/createCreditNote", { params }),
        offer: () => fiken.api.POST("/companies/{companySlug}/offers/drafts/{draftId}/createOffer", { params }),
        purchase: () => fiken.api.POST("/companies/{companySlug}/purchases/drafts/{draftId}/createPurchase", { params }),
        sale: () => fiken.api.POST("/companies/{companySlug}/sales/drafts/{draftId}/createSale", { params }),
      } satisfies Record<DraftKind, () => Promise<{ response: Response }>>
    )[input.type]();
    const id = newId(response, "at utkastet ble gjort endelig");
    return jsonResult({ finalized: input.type, id, document: await readFinal(fiken, companySlug, input.type, id) });
  },
});

/** The finished document, so the model can tell the user what was booked. */
async function readFinal(fiken: FikenClient, companySlug: string, type: DraftKind, id: number) {
  switch (type) {
    case "invoice": {
      const { data } = await fiken.api.GET("/companies/{companySlug}/invoices/{invoiceId}", { params: { path: { companySlug, invoiceId: id } } });
      return data ? invoiceSummary(data) : null;
    }
    case "credit_note": {
      const { data } = await fiken.api.GET("/companies/{companySlug}/creditNotes/{creditNoteId}", {
        params: { path: { companySlug, creditNoteId: String(id) } },
      });
      return data ? creditNoteSummary(data) : null;
    }
    case "offer": {
      const { data } = await fiken.api.GET("/companies/{companySlug}/offers/{offerId}", { params: { path: { companySlug, offerId: String(id) } } });
      return data ? { id: data.offerId, offerNumber: data.offerNumber, date: data.date, gross: (data.gross ?? 0) / 100 } : null;
    }
    case "purchase": {
      const { data } = await fiken.api.GET("/companies/{companySlug}/purchases/{purchaseId}", { params: { path: { companySlug, purchaseId: id } } });
      return data ? purchaseSummary(data) : null;
    }
    case "sale": {
      const { data } = await fiken.api.GET("/companies/{companySlug}/sales/{saleId}", { params: { path: { companySlug, saleId: id } } });
      return data ? saleSummary(data) : null;
    }
  }
}
