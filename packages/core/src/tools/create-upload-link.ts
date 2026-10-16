import * as z from "zod";
import { UPLOAD_TARGET_TYPES } from "../uploads.ts";
import { companyInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { defineTool, jsonResult, REVERSIBLE_WRITE } from "./tool.ts";

export const createUploadLink = defineTool({
  name: "create_upload_link",
  access: "write",
  title: "Lenke for opplasting av kvittering",
  description:
    "Gir en lenke der brukeren laster opp kvittering eller bilag (PDF eller bilde, maks 10 MB). Virker én gang i 15 minutter. " +
    "Filen legges på utkastet, kjøpet, salget eller i innboksen. Gi brukeren lenken, og sjekk vedlegget med find_* etterpå.",
  inputSchema: z.object({
    company: companyInput,
    target_type: z.enum(UPLOAD_TARGET_TYPES),
    target_id: fikenId("Utkast, kjøp eller salg. Ikke for inbox").optional(),
  }),
  annotations: REVERSIBLE_WRITE,
  async handler(input, { fiken, issueUploadLink }) {
    if (!issueUploadLink) throw new ToolError("Opplasting er ikke tilgjengelig her.");
    const companySlug = await resolveCompany(fiken, input.company);
    if (input.target_type !== "inbox" && input.target_id === undefined) throw new ToolError("Oppgi target_id.");

    // The target must exist before the user spends time uploading.
    const id = input.target_id ?? 0;
    const check = {
      inbox: () => Promise.resolve(),
      purchase_draft: () => fiken.api.GET("/companies/{companySlug}/purchases/drafts/{draftId}", { params: { path: { companySlug, draftId: id } } }),
      sale_draft: () => fiken.api.GET("/companies/{companySlug}/sales/drafts/{draftId}", { params: { path: { companySlug, draftId: id } } }),
      purchase: () => fiken.api.GET("/companies/{companySlug}/purchases/{purchaseId}", { params: { path: { companySlug, purchaseId: id } } }),
      sale: () => fiken.api.GET("/companies/{companySlug}/sales/{saleId}", { params: { path: { companySlug, saleId: id } } }),
    };
    await check[input.target_type]();

    const link = await issueUploadLink({ companySlug, type: input.target_type, id: input.target_id });
    return jsonResult({ url: link.url, expiresAt: link.expiresAt, note: "Lenken virker én gang. Be brukeren si fra når filen er lastet opp." });
  },
});
