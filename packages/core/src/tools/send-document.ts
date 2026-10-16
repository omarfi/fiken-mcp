import * as z from "zod";
import { companyInput, compact, fikenId, resolveCompany } from "./common.ts";
import { CONFIRM_FIRST, defineTool, DESTRUCTIVE, jsonResult } from "./tool.ts";

const METHODS = ["auto", "email", "ehf", "efaktura", "sms", "letter"] as const;

export const sendDocument = defineTool({
  name: "send_document",
  access: "write",
  title: "Send faktura, kreditnota eller tilbud",
  description:
    `Sender faktura, kreditnota eller tilbud til kunden. Kan ikke angres. auto: Fiken velger EHF eller e-post. Bekreft mottaker. ${CONFIRM_FIRST}`,
  inputSchema: z.object({
    company: companyInput,
    type: z.enum(["invoice", "credit_note", "offer"]),
    id: fikenId("ID"),
    method: z.enum(METHODS).default("auto"),
    recipient_email: z.string().optional().describe("Standard: kundens e-post"),
    message: z.string().optional(),
  }),
  annotations: { ...DESTRUCTIVE, openWorldHint: true },
  async handler(input, { fiken }) {
    const companySlug = await resolveCompany(fiken, input.company);
    const common = {
      method: [input.method],
      includeDocumentAttachments: true,
      // Fiken's own defaults: let it choose link or attachment, and keep attachments separate.
      emailSendOption: "auto" as const,
      mergeInvoiceAndAttachments: false,
      ...compact({ recipientEmail: input.recipient_email, message: input.message }),
    };
    const params = { path: { companySlug } };

    if (input.type === "invoice") {
      await fiken.api.POST("/companies/{companySlug}/invoices/send", { params, body: { ...common, invoiceId: input.id } });
    } else if (input.type === "credit_note") {
      await fiken.api.POST("/companies/{companySlug}/creditNotes/send", { params, body: { ...common, creditNoteId: input.id } });
    } else {
      await fiken.api.POST("/companies/{companySlug}/offers/send", { params, body: { ...common, offerId: input.id } });
    }
    return jsonResult({ sent: true, type: input.type, id: input.id, method: input.method });
  },
});
