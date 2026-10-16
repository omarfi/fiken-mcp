import * as z from "zod";
import { createdId, type FikenClient } from "../fiken/client.ts";
import type { components } from "../fiken/types.gen.ts";
import { kronerToOre } from "../money.ts";
import { netFromGross, type VatType } from "../vat.ts";
import { ToolError } from "./common.ts";

type Contact = components["schemas"]["contact"];

export const accountInput = (description: string) =>
  z
    .string()
    .refine((value) => /^\d{4}(:\d{5})?$/.test(value), "Kontonummer som 6800 eller 1920:10001")
    .describe(description);

export async function contactByOrgNumber(fiken: FikenClient, companySlug: string, organizationNumber: string): Promise<Contact | undefined> {
  const { data } = await fiken.api.GET("/companies/{companySlug}/contacts", {
    params: { path: { companySlug }, query: { organizationNumber, pageSize: 5 } },
  });
  return data?.[0];
}

/**
 * The contact a sale or purchase belongs to: by ID, or by organization number. A known
 * organization number without a contact stops here, so the model creates the contact instead of
 * booking a cash purchase or sale without one.
 */
export async function resolveCounterparty(
  fiken: FikenClient,
  companySlug: string,
  id: number | undefined,
  organizationNumber: string | undefined,
  role: "customer" | "supplier",
): Promise<number | undefined> {
  if (id !== undefined) return id;
  if (organizationNumber === undefined) return undefined;
  const contact = await contactByOrgNumber(fiken, companySlug, organizationNumber);
  if (contact?.contactId === undefined) {
    const what = role === "supplier" ? "leverandøren" : "kunden";
    throw new ToolError(`Fant ingen kontakt med org.nr. ${organizationNumber}. Opprett ${what} med save_contact (${role}: true) og prøv igjen.`);
  }
  return contact.contactId;
}

/** The new resource's ID from Location. Fiken answers 201 with an empty body. */
export function newId(response: Response, what: string): number {
  const id = Number(createdId(response));
  if (!Number.isSafeInteger(id)) {
    throw new ToolError(`Fiken bekreftet ikke ${what}. Sjekk med et find_*-verktøy om det ble laget før du prøver igjen.`);
  }
  return id;
}

/** A sale or purchase line from the receipt: the gross amount in kroner and the VAT type give net and gross in øre. */
export function draftLine(line: { description: string; gross: number; vat_type: VatType; account: string }) {
  const gross = kronerToOre(line.gross);
  return { text: line.description, vatType: line.vat_type, incomeAccount: line.account, gross, net: netFromGross(gross, line.vat_type) };
}

export const draftLinesInput = (vatType: z.ZodType<VatType>, accountDescription: string) =>
  z
    .array(
      z.object({
        description: z.string().min(1),
        gross: z.number().describe("Inkl. MVA, kroner"),
        vat_type: vatType,
        account: accountInput(accountDescription),
      }),
    )
    .min(1);
