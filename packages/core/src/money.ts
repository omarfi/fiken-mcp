import * as z from "zod";

/**
 * Fiken stores amounts as integer øre ("cents"). Tools take and show kroner. Every conversion
 * goes through this file.
 */

/** Kroner to øre. Rejects amounts with more than two decimals instead of rounding them away. */
export function kronerToOre(kroner: number): number {
  if (!Number.isFinite(kroner)) throw new RangeError("Beløpet må være et tall.");
  const ore = Math.round(kroner * 100);
  if (Math.abs(ore - kroner * 100) > 1e-6) throw new RangeError("Beløpet kan ha høyst to desimaler.");
  if (!Number.isSafeInteger(ore)) throw new RangeError("Beløpet er for stort.");
  return ore;
}

export function oreToKroner(ore: number): number {
  if (!Number.isSafeInteger(ore)) throw new RangeError(`Ugyldig beløp fra Fiken: ${ore}`);
  return ore / 100;
}

/** Input schema for an amount in kroner, with at most two decimals. */
export function kronerSchema(description = "Beløp i kroner, høyst to desimaler") {
  return z
    .number()
    .refine((value) => {
      try {
        kronerToOre(value);
        return true;
      } catch {
        return false;
      }
    }, "Beløpet må være et tall i kroner med høyst to desimaler.")
    .describe(description);
}
