import { oreToKroner } from "../money.ts";
import { AMOUNT_FIELDS } from "./ops.gen.ts";

/** About 3,000 tokens: the typical response budget in HANDOFF section 11. */
export const MAX_RESPONSE_CHARS = 12_000;
const MAX_NESTED_ITEMS = 20;

/**
 * Prepares a raw Fiken response for the model: amounts from øre to kroner (field names generated
 * from the spec), API-only download links removed, and the size capped.
 */
export function trimResponse(data: unknown): { data: unknown; note?: string } {
  const converted = convert(data);
  if (fits(converted)) return { data: converted };

  if (Array.isArray(converted)) {
    let items = converted;
    while (items.length > 1 && !fits(items)) items = items.slice(0, Math.max(1, Math.floor(items.length * 0.75)));
    if (fits(items)) {
      return { data: items, note: `Svaret var for stort, så bare de første ${items.length} av ${converted.length} radene vises. Bruk limit og page.` };
    }
  }
  const shortened = shortenArrays(converted);
  if (fits(shortened)) return { data: shortened, note: `Lange lister i svaret er kortet ned til ${MAX_NESTED_ITEMS} elementer.` };
  return { data: null, note: "Svaret er for stort til å vises. Bruk en mer avgrenset operasjon, eller limit og filtre." };
}

function convert(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => convert(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        // downloadUrl needs an API token; the ...WithFikenNormalUserCredentials link opens in Fiken.
        .filter(([name]) => name !== "downloadUrl")
        .map(([name, item]) => [name, convert(item, name)]),
    );
  }
  if (key !== undefined && AMOUNT_FIELDS.has(key) && typeof value === "number" && Number.isSafeInteger(value)) {
    return oreToKroner(value);
  }
  return value;
}

function shortenArrays(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, MAX_NESTED_ITEMS).map(shortenArrays);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, shortenArrays(item)]));
  }
  return value;
}

function fits(value: unknown): boolean {
  return JSON.stringify(value).length <= MAX_RESPONSE_CHARS;
}
