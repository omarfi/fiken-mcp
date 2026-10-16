import * as z from "zod";

/**
 * VAT types the write tools accept, with their rate in percent. Fiken's draft lines need both net
 * and gross, so tools take the gross amount from the receipt and derive the net here.
 *
 * Foreign services are reverse charged: the invoice carries no VAT, so net equals gross and Fiken
 * calculates the VAT itself. The DIRECT and BASIS purchase types and emission quotas are left to
 * the Fiken web app.
 */
const RATES = {
  HIGH: 25,
  MEDIUM: 15,
  LOW: 12,
  RAW_FISH: 11.11,
  NONE: 0,
  EXEMPT: 0,
  EXEMPT_IMPORT_EXPORT: 0,
  EXEMPT_REVERSE: 0,
  OUTSIDE: 0,
  HIGH_FOREIGN_SERVICE_DEDUCTIBLE: 0,
  HIGH_FOREIGN_SERVICE_NONDEDUCTIBLE: 0,
  LOW_FOREIGN_SERVICE_DEDUCTIBLE: 0,
  LOW_FOREIGN_SERVICE_NONDEDUCTIBLE: 0,
} as const;

export type VatType = keyof typeof RATES;

export const SALES_VAT_TYPES = ["HIGH", "MEDIUM", "LOW", "RAW_FISH", "NONE", "EXEMPT", "EXEMPT_IMPORT_EXPORT", "EXEMPT_REVERSE", "OUTSIDE"] as const;
/** The common purchase types. Foreign services with no deduction, and the rarer types, are left to the Fiken web app. */
export const PURCHASE_VAT_TYPES = ["HIGH", "MEDIUM", "LOW", "RAW_FISH", "NONE", "HIGH_FOREIGN_SERVICE_DEDUCTIBLE"] as const;
/** Fiken's product VAT types (spec: product.vatType). */
export const PRODUCT_VAT_TYPES = ["HIGH", "MEDIUM", "LOW", "EXEMPT", "EXEMPT_IMPORT_EXPORT", "EXEMPT_REVERSE", "OUTSIDE", "NONE"] as const;

export const salesVatInput = z.enum(SALES_VAT_TYPES);
export const purchaseVatInput = z.enum(PURCHASE_VAT_TYPES).describe("HIGH_FOREIGN_SERVICE_DEDUCTIBLE: tjeneste fra utlandet");

/** Net øre from gross øre for a VAT type, rounded to whole øre. */
export function netFromGross(grossOre: number, vatType: VatType): number {
  const rate = RATES[vatType];
  return rate === 0 ? grossOre : Math.round((grossOre * 100) / (100 + rate));
}
