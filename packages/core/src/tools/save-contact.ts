import * as z from "zod";
import { isValidOrganizationNumber, type Organization } from "../brreg.ts";
import type { FikenClient } from "../fiken/client.ts";
import type { components } from "../fiken/types.gen.ts";
import { compact, companyInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { contactDetail } from "./summaries.ts";
import { defineTool, jsonResult, REVERSIBLE_WRITE } from "./tool.ts";
import { contactByOrgNumber, newId } from "./write-common.ts";

type Contact = components["schemas"]["contact"];

/** Fields a PUT must carry: Fiken replaces the whole contact (measured), so everything is sent back. */
const WRITABLE: (keyof Contact)[] = [
  "name",
  "email",
  "organizationNumber",
  "phoneNumber",
  "memberNumber",
  "memberNumberString",
  "customer",
  "supplier",
  "bankAccountNumber",
  "contactPerson",
  "currency",
  "language",
  "inactive",
  "daysUntilInvoicingDueDate",
  "discount",
  "address",
  "groups",
];

export const saveContact = defineTool({
  name: "save_contact",
  access: "write",
  title: "Opprett eller endre kontakt",
  description:
    "Kunde eller leverandør. Med org_number hentes navn og adresse fra Enhetsregisteret, og det stopper hvis kontakten finnes. " +
    "Med id: endrer bare feltene du sender.",
  inputSchema: z.object({
    company: companyInput,
    id: fikenId("For å endre").optional(),
    org_number: z.string().optional(),
    name: z.string().min(1).optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z
      .object({ street: z.string().optional(), post_code: z.string().optional(), city: z.string().optional(), country: z.string().default("Norge") })
      .optional(),
    customer: z.boolean().optional(),
    supplier: z.boolean().optional(),
    inactive: z.boolean().optional(),
    contact_persons: z
      .array(z.object({ name: z.string().min(1), email: z.string().min(1), phone: z.string().optional() }))
      .optional()
      .describe("Legges til"),
    allow_similar_name: z.boolean().default(false).describe("Brukeren har bekreftet at det er en annen kontakt"),
  }),
  annotations: REVERSIBLE_WRITE,
  async handler(input, { fiken, lookupOrganization }) {
    const companySlug = await resolveCompany(fiken, input.company);
    const orgNumber = input.org_number?.replace(/\s/g, "");
    if (orgNumber !== undefined && !isValidOrganizationNumber(orgNumber)) {
      throw new ToolError(`${input.org_number} er ikke et gyldig organisasjonsnummer.`);
    }

    const changes = compact({
      name: input.name,
      email: input.email,
      phoneNumber: input.phone,
      organizationNumber: orgNumber,
      customer: input.customer,
      supplier: input.supplier,
      inactive: input.inactive,
      address: input.address
        ? compact({ streetAddress: input.address.street, postCode: input.address.post_code, city: input.address.city, country: input.address.country })
        : undefined,
    }) as Partial<Contact>;

    const notes: string[] = [];
    let contactId: number;
    let created = false;

    if (input.id !== undefined) {
      const { data: existing } = await fiken.api.GET("/companies/{companySlug}/contacts/{contactId}", {
        params: { path: { companySlug, contactId: input.id } },
      });
      if (!existing) throw new ToolError(`Fant ikke kontakt ${input.id}.`);
      const body = { ...pick(existing), ...changes } as Contact;
      await fiken.api.PUT("/companies/{companySlug}/contacts/{contactId}", {
        params: { path: { companySlug, contactId: input.id } },
        body,
      });
      contactId = input.id;
    } else {
      if (orgNumber) {
        const duplicate = await contactByOrgNumber(fiken, companySlug, orgNumber);
        if (duplicate) {
          throw new ToolError(
            `Kontakten finnes allerede: ${duplicate.name} (id ${duplicate.contactId}). Bruk save_contact med id for å endre den.`,
          );
        }
        const organization = await lookupOrganization(orgNumber);
        if (organization) Object.assign(changes, fromRegister(organization, changes));
        else notes.push(`Fant ikke org.nr. ${orgNumber} i Enhetsregisteret. Sjekk nummeret.`);
        if (organization?.bankrupt) notes.push("Enhetsregisteret melder at foretaket er konkurs.");
        if (organization?.underLiquidation) notes.push("Enhetsregisteret melder at foretaket er under avvikling.");
      }
      if (!changes.name) throw new ToolError("Oppgi name, eller et org_number som finnes i Enhetsregisteret.");
      if (!changes.customer && !changes.supplier) throw new ToolError("Oppgi customer: true og/eller supplier: true.");
      if (!input.allow_similar_name) await refuseSimilarName(fiken, companySlug, changes.name);

      const { response } = await fiken.api.POST("/companies/{companySlug}/contacts", {
        params: { path: { companySlug } },
        body: { customer: false, supplier: false, ...changes } as Contact,
      });
      contactId = newId(response, "at kontakten ble opprettet");
      created = true;
    }

    for (const person of input.contact_persons ?? []) {
      await fiken.api.POST("/companies/{companySlug}/contacts/{contactId}/contactPerson", {
        params: { path: { companySlug, contactId } },
        body: compact({ name: person.name, email: person.email, phoneNumber: person.phone }) as components["schemas"]["contactPerson"],
      });
    }

    return jsonResult({ created, contact: await readBack(fiken, companySlug, contactId), ...(notes.length ? { notes } : {}) });
  },
});

function pick(contact: Contact): Partial<Contact> {
  return Object.fromEntries(WRITABLE.filter((key) => contact[key] !== undefined).map((key) => [key, contact[key]]));
}

/** Name and address from the register, unless the user gave them. */
function fromRegister(organization: Organization, given: Partial<Contact>): Partial<Contact> {
  return {
    name: given.name ?? organization.name,
    ...(given.address || !organization.address ? {} : { address: compact({ ...organization.address }) as Contact["address"] }),
  };
}

async function refuseSimilarName(fiken: FikenClient, companySlug: string, name: string): Promise<void> {
  const { data } = await fiken.api.GET("/companies/{companySlug}/contacts", {
    params: { path: { companySlug }, query: { name, pageSize: 5 } },
  });
  const similar = (data ?? []).filter((contact) => normalize(contact.name) === normalize(name));
  if (similar.length > 0) {
    throw new ToolError(
      `Det finnes allerede en kontakt med samme navn: ${similar.map((contact) => `${contact.name} (id ${contact.contactId})`).join(", ")}. ` +
        "Bruk den, eller spør brukeren og send allow_similar_name: true hvis det er en annen.",
    );
  }
}

function normalize(name: string | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9æøå]/g, "");
}

async function readBack(fiken: FikenClient, companySlug: string, contactId: number) {
  const path = { companySlug, contactId };
  const { data: contact } = await fiken.api.GET("/companies/{companySlug}/contacts/{contactId}", { params: { path } });
  const { data: persons } = await fiken.api.GET("/companies/{companySlug}/contacts/{contactId}/contactPerson", { params: { path } });
  return contact ? contactDetail(contact, persons ?? []) : null;
}
