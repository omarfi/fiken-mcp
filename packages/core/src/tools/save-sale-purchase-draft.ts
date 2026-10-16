import * as z from "zod";
import type { FikenClient } from "../fiken/client.ts";
import type { components } from "../fiken/types.gen.ts";
import { purchaseVatInput, salesVatInput } from "../vat.ts";
import { compact, companyInput, dateInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { draftDetail } from "./summaries.ts";
import { defineTool, jsonResult, REVERSIBLE_WRITE } from "./tool.ts";
import { accountInput, draftLine, draftLinesInput, newId, resolveCounterparty } from "./write-common.ts";

type DraftRequest = components["schemas"]["draftRequest"];
type DraftResult = components["schemas"]["draftResult"];
type Kind = "purchase" | "sale";

const NEXT = "Utkastet er ikke bokført. Bokfør med finalize_draft når brukeren har bekreftet.";

export const savePurchaseDraft = defineTool({
  name: "save_purchase_draft",
  access: "write",
  title: "Lag eller endre kjøpsutkast",
  description:
    "Kjøpsutkast. Bokfører ikke. Har leverandøren org.nr., send supplier_org_number, så kjøpet kobles til kontakten i stedet for kontantkjøp. " +
    "Med id: endrer bare feltene du sender.",
  inputSchema: z.object({
    company: companyInput,
    id: fikenId("For å endre").optional(),
    kind: z.enum(["supplier", "cash"]).optional().describe("Standard supplier. cash: betalt med en gang"),
    supplier_id: fikenId("Kontakt-ID").optional(),
    supplier_org_number: z.string().optional(),
    date: dateInput("ÅÅÅÅ-MM-DD").optional(),
    due_date: dateInput("Forfall").optional(),
    invoice_number: z.string().optional(),
    kid: z.string().optional(),
    lines: draftLinesInput(purchaseVatInput, "Kostnadskonto").optional(),
    paid: z.boolean().optional().describe("Krever payment_account"),
    payment_account: accountInput("F.eks. 1920:10001").optional(),
    inbox_document_id: fikenId("Vedlegg fra find_inbox").optional(),
  }),
  annotations: REVERSIBLE_WRITE,
  handler: (input, { fiken }) =>
    saveDraft(fiken, "purchase", { ...input, counterpartyId: input.supplier_id, counterpartyOrgNumber: input.supplier_org_number }),
});

export const saveSaleDraft = defineTool({
  name: "save_sale_draft",
  access: "write",
  title: "Lag eller endre salgsutkast",
  description:
    "Utkast for annet salg: kontant, Vipps, nettbutikk. Fakturaer: save_invoice_draft. Bokfører ikke. Med id: endrer bare feltene du sender.",
  inputSchema: z.object({
    company: companyInput,
    id: fikenId("For å endre").optional(),
    customer_id: fikenId("Kontakt-ID").optional(),
    customer_org_number: z.string().optional(),
    date: dateInput("ÅÅÅÅ-MM-DD").optional(),
    lines: draftLinesInput(salesVatInput, "Inntektskonto").optional(),
    paid: z.boolean().optional().describe("Standard true. Krever payment_account"),
    payment_account: accountInput("F.eks. 1920:10001").optional(),
  }),
  annotations: REVERSIBLE_WRITE,
  handler: (input, { fiken }) =>
    saveDraft(fiken, "sale", { ...input, counterpartyId: input.customer_id, counterpartyOrgNumber: input.customer_org_number }),
});

interface DraftInput {
  company?: string | undefined;
  id?: number | undefined;
  kind?: "supplier" | "cash" | undefined;
  counterpartyId?: number | undefined;
  counterpartyOrgNumber?: string | undefined;
  date?: string | undefined;
  due_date?: string | undefined;
  invoice_number?: string | undefined;
  kid?: string | undefined;
  lines?: Parameters<typeof draftLine>[0][] | undefined;
  paid?: boolean | undefined;
  payment_account?: string | undefined;
  inbox_document_id?: number | undefined;
}

async function saveDraft(fiken: FikenClient, kind: Kind, input: DraftInput) {
  const companySlug = await resolveCompany(fiken, input.company);
  const role = kind === "purchase" ? "supplier" : "customer";
  const contactId = await resolveCounterparty(fiken, companySlug, input.counterpartyId, input.counterpartyOrgNumber, role);
  const existing = input.id === undefined ? undefined : await getDraft(fiken, kind, companySlug, input.id);

  const base = existing ? toRequest(existing) : undefined;
  const lines = input.lines?.map(draftLine) ?? base?.lines;
  // A sale draft here is a cash sale when it is paid at once. A purchase is cash only when asked for.
  const cash = kind === "sale" ? (input.paid ?? base?.paid ?? true) : input.kind !== undefined ? input.kind === "cash" : (base?.cash ?? false);
  const paid = kind === "sale" ? cash : (input.paid ?? (cash ? true : (base?.paid ?? false)));
  const date = input.date ?? base?.invoiceIssueDate;

  if (!lines?.length) throw new ToolError("Oppgi minst én linje.");
  if (!date) throw new ToolError("Oppgi date.");
  if (kind === "purchase" && !cash && (contactId ?? base?.contactId) === undefined) {
    throw new ToolError("Et leverandørkjøp trenger leverandør: send supplier_id eller supplier_org_number. Bruk kind=cash bare for kjøp uten faktura.");
  }
  const total = lines.reduce((sum, line) => sum + line.gross, 0);
  const paymentAccount = input.payment_account ?? base?.payments?.[0]?.account;
  if (paid && !paymentAccount) throw new ToolError("Et betalt utkast trenger payment_account, for eksempel 1920:10001.");

  const body: DraftRequest = {
    ...base,
    ...compact({ invoiceIssueDate: date, dueDate: input.due_date, invoiceNumber: input.invoice_number, kid: input.kid, contactId }),
    cash,
    paid,
    lines,
    payments: paid && paymentAccount ? [{ date, account: paymentAccount, amount: total }] : [],
  };

  let draftId: number;
  if (existing && input.id !== undefined) {
    await putDraft(fiken, kind, companySlug, input.id, body);
    draftId = input.id;
  } else {
    draftId = await postDraft(fiken, kind, companySlug, body);
  }

  if (input.inbox_document_id !== undefined) {
    if (kind !== "purchase") throw new ToolError("inbox_document_id gjelder bare kjøp.");
    // Fiken answers 415 without a multipart body, even when the file comes from the inbox (measured).
    await fiken.api.POST("/companies/{companySlug}/purchases/drafts/{draftId}/attachments", {
      params: { path: { companySlug, draftId }, query: { inboxDocumentId: input.inbox_document_id } },
      body: new FormData() as never,
    });
  }

  const saved = await getDraft(fiken, kind, companySlug, draftId);
  return jsonResult({ created: existing === undefined, draft: draftDetail(saved), note: NEXT });
}

/** Back from a draft as Fiken shows it to the request it takes, since PUT replaces everything (measured). */
function toRequest(draft: DraftResult): DraftRequest {
  return {
    ...compact({
      invoiceIssueDate: draft.invoiceIssueDate,
      dueDate: draft.dueDate,
      invoiceNumber: draft.invoiceNumber,
      contactId: draft.contact?.contactId,
      projectId: draft.project?.projectId,
      currency: draft.currency,
      kid: draft.kid,
    }),
    cash: draft.cash ?? false,
    paid: draft.paid ?? false,
    payments: draft.payments?.map((payment) => compact({ date: payment.date, account: payment.account, amount: payment.amount, currency: payment.currency })),
    lines: (draft.lines ?? []).map((line) =>
      compact({ text: line.text, vatType: line.vatType, incomeAccount: line.incomeAccount, net: line.net, gross: line.gross, projectId: line.project?.projectId }),
    ) as DraftRequest["lines"],
  } as DraftRequest;
}

async function getDraft(fiken: FikenClient, kind: Kind, companySlug: string, draftId: number): Promise<DraftResult> {
  const params = { path: { companySlug, draftId } };
  const { data } =
    kind === "purchase"
      ? await fiken.api.GET("/companies/{companySlug}/purchases/drafts/{draftId}", { params })
      : await fiken.api.GET("/companies/{companySlug}/sales/drafts/{draftId}", { params });
  if (!data) throw new ToolError(`Fant ikke utkast ${draftId}.`);
  return data;
}

async function postDraft(fiken: FikenClient, kind: Kind, companySlug: string, body: DraftRequest): Promise<number> {
  const params = { path: { companySlug } };
  const { response } =
    kind === "purchase"
      ? await fiken.api.POST("/companies/{companySlug}/purchases/drafts", { params, body })
      : await fiken.api.POST("/companies/{companySlug}/sales/drafts", { params, body });
  return newId(response, "at utkastet ble laget");
}

async function putDraft(fiken: FikenClient, kind: Kind, companySlug: string, draftId: number, body: DraftRequest): Promise<void> {
  const params = { path: { companySlug, draftId } };
  if (kind === "purchase") await fiken.api.PUT("/companies/{companySlug}/purchases/drafts/{draftId}", { params, body });
  else await fiken.api.PUT("/companies/{companySlug}/sales/drafts/{draftId}", { params, body });
}
