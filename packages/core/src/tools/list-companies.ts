import * as z from "zod";
import { MAX_PAGE_SIZE } from "../fiken/client.ts";
import { defineTool, jsonResult } from "./tool.ts";

export const listCompanies = defineTool({
  name: "list_companies",
  access: "read",
  title: "Foretak",
  description:
    "Viser foretakene brukeren har gitt denne koblingen tilgang til i Fiken: navn, organisasjonsnummer og slug. " +
    "Slug brukes som `company` i de andre verktøyene. Har brukeren flere foretak, spør hvilket det gjelder før du går videre. " +
    "Mangler et foretak, kan brukeren gi tilgang i Fiken under Rediger konto → Sikkerhet → Apper du har gitt tilgang til.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async handler(_input, { fiken }) {
    const page = await fiken.listCompanies();
    const companies = page.items.map((company) => ({
      name: company.name,
      slug: company.slug,
      organizationNumber: company.organizationNumber,
      testCompany: company.testCompany,
      hasApiAccess: company.hasApiAccess,
    }));

    const notes: string[] = [];
    if (companies.length === 0) {
      notes.push("Koblingen har ikke tilgang til noen foretak. Brukeren kan gi tilgang i Fiken under Rediger konto → Sikkerhet → Apper du har gitt tilgang til.");
    }
    if (companies.some((company) => company.hasApiAccess === false && company.testCompany !== true)) {
      notes.push("Foretak med hasApiAccess=false mangler Fikens API-tillegg (99 kr/mnd), og kan ikke brukes før det er aktivert i Fiken.");
    }
    if (page.total !== undefined && page.total > MAX_PAGE_SIZE) {
      notes.push(`Viser de første ${MAX_PAGE_SIZE} av ${page.total} foretak.`);
    }

    return jsonResult(notes.length > 0 ? { companies, notes } : { companies });
  },
});
