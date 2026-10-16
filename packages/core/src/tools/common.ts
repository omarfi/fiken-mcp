import * as z from "zod";
import { MAX_PAGE_SIZE, resultCount, type FikenClient } from "../fiken/client.ts";
import { oreToKroner } from "../money.ts";

/** A problem with the tool input that the model can fix. Shown to the model as is. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export const DEFAULT_LIMIT = 20;

export const companyInput = z
  .string()
  // Fiken slugs are lowercase letters, digits and dashes (measured); anything else could alter a path.
  .refine((value) => /^[a-z0-9][a-z0-9_-]*$/.test(value) && value.length <= 100, "Ugyldig foretak. Bruk slug fra list_companies.")
  .optional()
  .describe("Slug fra list_companies. Utelates ved ett foretak.");

export const limitInput = z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_LIMIT).describe("Standard 20, maks 100");
export const pageInput = z.number().int().min(0).max(10_000).default(0).describe("Fra 0");

/**
 * A Fiken ID. Checked as an integer at run time rather than with `.int()`, which would put
 * `maximum: 9007199254740991` into every tool definition the model reads.
 */
export const fikenId = (description: string) =>
  z.number().positive().refine(Number.isSafeInteger, "Må være et heltall").describe(description);

/** A date. Checked at run time rather than with a regex pattern, to keep tool definitions short. */
export const dateInput = (description: string) =>
  z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Dato må ha formatet ÅÅÅÅ-MM-DD")
    .describe(description);

export const idInput = (what: string) => fikenId(`${what}-ID. Gir full detalj.`).optional();

/** The slug to use: the given one, or the only company the user has. */
export async function resolveCompany(fiken: FikenClient, company: string | undefined): Promise<string> {
  if (company) return company;
  const { items } = await fiken.listCompanies();
  const [only] = items;
  if (items.length === 1 && only?.slug) return only.slug;
  if (items.length === 0) throw new ToolError("Koblingen har ikke tilgang til noen foretak i Fiken.");
  throw new ToolError(
    `Brukeren har ${items.length} foretak. Spør hvilket det gjelder, og send company. Valg: ${items.map((item) => `${item.name} (${item.slug})`).join(", ")}.`,
  );
}

export function checkPeriod(from: string | undefined, to: string | undefined): void {
  if (from && to && from > to) throw new ToolError("Fra-datoen er etter til-datoen.");
}

export interface Paging {
  page: number;
  limit: number;
  total: number | undefined;
  more: boolean;
}

export function paging(page: number, limit: number, returned: number, response: Response): Paging {
  const total = resultCount(response);
  return { page, limit, total, more: total === undefined ? returned === limit : (page + 1) * limit < total };
}

type FetchPage<T> = (page: number, pageSize: number) => Promise<{ data?: T[] | undefined; response: Response }>;

/**
 * Newest first over a Fiken list that only comes oldest first (invoices, sales, journal entries
 * have no sortBy; measured). Page 0 is the newest `limit` items.
 *
 * The first call reads Fiken's page 0 and the total. If everything fits, that is the only call.
 * Otherwise the newest-first page spans at most two of Fiken's pages, so a list costs 1–3 calls.
 */
export async function newestFirst<T>(fetchPage: FetchPage<T>, page: number, limit: number): Promise<{ items: T[]; paging: Paging }> {
  const first = await fetchPage(0, limit);
  const firstItems = first.data ?? [];
  const total = resultCount(first.response) ?? firstItems.length;

  // Indices [start, end) in Fiken's oldest-first order.
  const end = total - page * limit;
  const start = Math.max(0, end - limit);
  const result = (items: T[]) => ({ items, paging: { page, limit, total, more: start > 0 } });
  if (end <= 0) return result([]);

  const fromPage = Math.floor(start / limit);
  const toPage = Math.floor((end - 1) / limit);
  const loaded: T[] = [];
  for (let fikenPage = fromPage; fikenPage <= toPage; fikenPage++) {
    loaded.push(...(fikenPage === 0 ? firstItems : ((await fetchPage(fikenPage, limit)).data ?? [])));
  }
  const offset = fromPage * limit;
  return result(loaded.slice(start - offset, end - offset).reverse());
}

/** Like fetchPages, but from the last page backwards, so a capped scan keeps the newest items. */
export async function fetchPagesNewestFirst<T>(fetchPage: FetchPage<T>, maxPages: number): Promise<{ items: T[]; complete: boolean }> {
  const first = await fetchPage(0, MAX_PAGE_SIZE);
  const total = resultCount(first.response);
  const firstItems = first.data ?? [];
  const pages = total === undefined ? 1 : Math.max(1, Math.ceil(total / MAX_PAGE_SIZE));
  const items: T[] = [];
  for (let page = pages - 1; page >= 0 && pages - page <= maxPages; page--) {
    const batch = page === 0 ? firstItems : ((await fetchPage(page, MAX_PAGE_SIZE)).data ?? []);
    items.push(...[...batch].reverse());
  }
  return { items, complete: pages <= maxPages };
}

/** Local paging over items already fetched and filtered here. */
export function pageLocally<T>(items: T[], page: number, limit: number): { items: T[]; paging: Paging } {
  const slice = items.slice(page * limit, (page + 1) * limit);
  return { items: slice, paging: { page, limit, total: items.length, more: (page + 1) * limit < items.length } };
}

/**
 * Fetches page after page of 100 until Fiken has no more or `maxPages` is reached. `complete` is
 * false when there were more pages than allowed.
 */
export async function fetchPages<T>(
  fetchPage: (page: number) => Promise<{ data?: T[] | undefined; response: Response }>,
  maxPages: number,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, response } = await fetchPage(page);
    const batch = data ?? [];
    items.push(...batch);
    const total = resultCount(response);
    const done = total === undefined ? batch.length < MAX_PAGE_SIZE : items.length >= total;
    if (done) return { items, complete: true };
  }
  return { items, complete: false };
}

/** Øre from Fiken to kroner for display. Keeps undefined. */
export function kr(ore: number | undefined): number | undefined {
  return ore === undefined ? undefined : oreToKroner(ore);
}

/** Drops undefined, null and empty arrays, so summaries stay small. */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && v !== ""),
  ) as Partial<T>;
}

/** The day before a YYYY-MM-DD date. */
export function dayBefore(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** Today's date in Norway, YYYY-MM-DD. */
export function todayInNorway(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(now);
}
