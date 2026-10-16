import * as z from "zod";
import { companyInput, fikenId, resolveCompany } from "./common.ts";
import { DRAFT_TYPES, type DraftKind } from "./finalize-draft.ts";
import { CONFIRM_FIRST, defineTool, DESTRUCTIVE, jsonResult } from "./tool.ts";

export const deleteDraft = defineTool({
  name: "delete_draft",
  access: "write",
  title: "Slett utkast",
  description: `Sletter et utkast til faktura, kreditnota, tilbud, kjøp eller salg. Kan ikke angres. ${CONFIRM_FIRST}`,
  inputSchema: z.object({ company: companyInput, type: z.enum(DRAFT_TYPES), id: fikenId("Utkast-ID") }),
  annotations: DESTRUCTIVE,
  async handler(input, { fiken }) {
    const companySlug = await resolveCompany(fiken, input.company);
    const params = { path: { companySlug, draftId: input.id } };
    await (
      {
        invoice: () => fiken.api.DELETE("/companies/{companySlug}/invoices/drafts/{draftId}", { params }),
        credit_note: () => fiken.api.DELETE("/companies/{companySlug}/creditNotes/drafts/{draftId}", { params }),
        offer: () => fiken.api.DELETE("/companies/{companySlug}/offers/drafts/{draftId}", { params }),
        purchase: () => fiken.api.DELETE("/companies/{companySlug}/purchases/drafts/{draftId}", { params }),
        sale: () => fiken.api.DELETE("/companies/{companySlug}/sales/drafts/{draftId}", { params }),
      } satisfies Record<DraftKind, () => Promise<unknown>>
    )[input.type]();
    return jsonResult({ deleted: true, type: input.type, id: input.id });
  },
});
