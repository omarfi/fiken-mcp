import * as z from "zod";
import type { FikenClient } from "../fiken/client.ts";
import type { components } from "../fiken/types.gen.ts";
import { kronerSchema, kronerToOre } from "../money.ts";
import { salesVatInput } from "../vat.ts";
import { compact, companyInput, dateInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { invoiceishDraftDetail } from "./summaries.ts";
import { defineTool, jsonResult, REVERSIBLE_WRITE } from "./tool.ts";
import { accountInput, newId } from "./write-common.ts";

type DraftRequest = components["schemas"]["invoiceishDraftRequest"];
type DraftResult = components["schemas"]["invoiceishDraftResult"];
type DraftType = "invoice" | "credit_note" | "offer";

const NEXT: Record<DraftType, string> = {
  invoice: "Ikke bokført. Vis brukeren utkastet, gjør det til faktura med finalize_draft etter bekreftelse, og send med send_document etter ny bekreftelse.",
  credit_note: "Ikke bokført. Gjør det til kreditnota med finalize_draft etter bekreftelse. For å kreditere en bestemt faktura: credit_invoice.",
  offer: "Ikke sendt. Gjør det til tilbud med finalize_draft etter bekreftelse, og send med send_document.",
};

export const saveInvoiceDraft = defineTool({
  name: "save_invoice_draft",
  access: "write",
  title: "Lag eller endre fakturautkast",
  description:
    "Utkast til faktura, uavhengig kreditnota eller tilbud. Bokfører ikke. Pris eks. MVA i kroner. Linje: product_id, eller description og " +
    "unit_price (standard HIGH, konto 3000). Med id: endrer bare feltene du sender.",
  inputSchema: z.object({
    company: companyInput,
    id: fikenId("For å endre").optional(),
    type: z.enum(["invoice", "credit_note", "offer"]).default("invoice"),
    customer_id: fikenId("Kontakt-ID").optional(),
    lines: z
      .array(
        z.object({
          product_id: fikenId("Fra find_products").optional(),
          description: z.string().optional(),
          quantity: z.number().positive().default(1),
          unit_price: kronerSchema("Eks. MVA").optional(),
          vat_type: salesVatInput.optional(),
          income_account: accountInput("Konto").optional(),
          discount: z.number().min(0).max(100).optional().describe("Prosent"),
        }),
      )
      .min(1)
      .optional(),
    issue_date: dateInput("ÅÅÅÅ-MM-DD, standard i dag").optional(),
    due_days: z.number().int().min(0).max(365).optional().describe("Standard 14"),
    invoice_text: z.string().optional(),
    your_reference: z.string().optional(),
    our_reference: z.string().optional(),
    order_reference: z.string().optional(),
    from_time_entries: z.array(z.number().positive()).min(1).optional().describe("Timer som faktureres"),
    from_order_confirmation_id: fikenId("Lag fra ordrebekreftelse").optional(),
  }),
  annotations: REVERSIBLE_WRITE,
  async handler(input, { fiken, today }) {
    const companySlug = await resolveCompany(fiken, input.company);
    const type: DraftType = input.type;

    if (input.from_order_confirmation_id !== undefined) {
      const { response } = await fiken.api.POST("/companies/{companySlug}/orderConfirmations/{confirmationId}/createInvoiceDraft", {
        params: { path: { companySlug, confirmationId: String(input.from_order_confirmation_id) } },
      });
      return result(fiken, companySlug, "invoice", newId(response, "fakturautkastet"), true);
    }

    if (input.from_time_entries) {
      if (input.customer_id === undefined) throw new ToolError("Oppgi customer_id for å fakturere timer.");
      const { response } = await fiken.api.POST("/companies/{companySlug}/timeEntries/createInvoiceDraft", {
        params: { path: { companySlug } },
        // Fiken's documented defaults: one line per activity, without each entry's description.
        body: {
          timeEntryIds: input.from_time_entries,
          customerId: input.customer_id,
          daysUntilDueDate: input.due_days ?? 14,
          groupBy: "activity",
          includeTimeEntryDescriptions: false,
          currency: "NOK",
        },
      });
      return result(fiken, companySlug, "invoice", newId(response, "fakturautkastet"), true);
    }

    const existing = input.id === undefined ? undefined : toRequest(await getDraft(fiken, type, companySlug, input.id));
    const lines = input.lines?.map((line) => {
      if (line.product_id === undefined && (!line.description || line.unit_price === undefined)) {
        throw new ToolError("En linje uten product_id trenger description og unit_price.");
      }
      return compact({
        productId: line.product_id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unit_price === undefined ? undefined : kronerToOre(line.unit_price),
        vatType: line.vat_type ?? (line.product_id === undefined ? "HIGH" : undefined),
        incomeAccount: line.income_account ?? (line.product_id === undefined ? "3000" : undefined),
        discount: line.discount,
      }) as NonNullable<DraftRequest["lines"]>[number];
    });

    const body: DraftRequest = {
      ...existing,
      ...compact({
        customerId: input.customer_id,
        issueDate: input.issue_date,
        daysUntilDueDate: input.due_days,
        invoiceText: input.invoice_text,
        yourReference: input.your_reference,
        ourReference: input.our_reference,
        orderReference: input.order_reference,
        lines,
      }),
    } as DraftRequest;
    body.type ??= type;
    body.issueDate ??= today;
    body.daysUntilDueDate ??= 14;
    if (body.customerId === undefined) throw new ToolError("Oppgi customer_id. Finn kunden med find_contacts, eller opprett den med save_contact.");
    if (!body.lines?.length) throw new ToolError("Oppgi minst én linje.");

    if (input.id !== undefined) {
      await putDraft(fiken, type, companySlug, input.id, body);
      return result(fiken, companySlug, type, input.id, false);
    }
    return result(fiken, companySlug, type, await postDraft(fiken, type, companySlug, body), true);
  },
});

async function result(fiken: FikenClient, companySlug: string, type: DraftType, draftId: number, created: boolean) {
  const draft = await getDraft(fiken, type, companySlug, draftId);
  return jsonResult({ created, draft: invoiceishDraftDetail(draft), note: NEXT[type] });
}

/** Back from a draft as Fiken shows it to the request it takes, since PUT replaces everything (measured). */
function toRequest(draft: DraftResult): DraftRequest {
  return compact({
    type: draft.type,
    uuid: draft.uuid,
    issueDate: draft.issueDate,
    daysUntilDueDate: draft.daysUntilDueDate,
    invoiceText: draft.invoiceText,
    yourReference: draft.yourReference,
    ourReference: draft.ourReference,
    orderReference: draft.orderReference,
    currency: draft.currency,
    bankAccountNumber: draft.bankAccountNumber,
    iban: draft.iban,
    bic: draft.bic,
    paymentAccount: draft.paymentAccount,
    customerId: draft.customers?.[0]?.contactId,
    projectId: draft.projectId,
    roundingType: draft.roundingType,
    lines: draft.lines?.map((line) =>
      compact({
        productId: line.productId,
        description: line.description,
        unitPrice: line.unitPrice,
        vatType: line.vatType,
        quantity: line.quantity,
        discount: line.discount,
        comment: line.comment,
        incomeAccount: line.incomeAccount,
      }),
    ),
  }) as DraftRequest;
}

async function getDraft(fiken: FikenClient, type: DraftType, companySlug: string, draftId: number): Promise<DraftResult> {
  const params = { path: { companySlug, draftId } };
  const { data } =
    type === "invoice"
      ? await fiken.api.GET("/companies/{companySlug}/invoices/drafts/{draftId}", { params })
      : type === "credit_note"
        ? await fiken.api.GET("/companies/{companySlug}/creditNotes/drafts/{draftId}", { params })
        : await fiken.api.GET("/companies/{companySlug}/offers/drafts/{draftId}", { params });
  if (!data) throw new ToolError(`Fant ikke utkast ${draftId}.`);
  return data;
}

async function postDraft(fiken: FikenClient, type: DraftType, companySlug: string, body: DraftRequest): Promise<number> {
  const params = { path: { companySlug } };
  const { response } =
    type === "invoice"
      ? await fiken.api.POST("/companies/{companySlug}/invoices/drafts", { params, body })
      : type === "credit_note"
        ? await fiken.api.POST("/companies/{companySlug}/creditNotes/drafts", { params, body })
        : await fiken.api.POST("/companies/{companySlug}/offers/drafts", { params, body });
  return newId(response, "at utkastet ble laget");
}

async function putDraft(fiken: FikenClient, type: DraftType, companySlug: string, draftId: number, body: DraftRequest): Promise<void> {
  const params = { path: { companySlug, draftId } };
  if (type === "invoice") await fiken.api.PUT("/companies/{companySlug}/invoices/drafts/{draftId}", { params, body });
  else if (type === "credit_note") await fiken.api.PUT("/companies/{companySlug}/creditNotes/drafts/{draftId}", { params, body });
  else await fiken.api.PUT("/companies/{companySlug}/offers/drafts/{draftId}", { params, body });
}
