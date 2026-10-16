import { FikenApiError, readFikenMessage } from "./errors.ts";
import type { FikenTransport } from "./transport.ts";
import type { components } from "./types.gen.ts";

export type Company = components["schemas"]["company"];

export type QueryValue = string | number | boolean | undefined;

/** Fiken's maximum page size. */
export const MAX_PAGE_SIZE = 100;

export interface Page<T> {
  items: T[];
  /** Total number of items across all pages, from `Fiken-Api-Result-Count`. */
  total: number | undefined;
}

/** Typed access to the Fiken API v2. All calls go through the injected transport. */
export class FikenClient {
  readonly #transport: FikenTransport;

  constructor(transport: FikenTransport) {
    this.#transport = transport;
  }

  async listCompanies(): Promise<Page<Company>> {
    return this.getPage<Company>("/companies", { page: 0, pageSize: MAX_PAGE_SIZE, sortBy: "name asc" });
  }

  async getPage<T>(path: string, query: Record<string, QueryValue> = {}): Promise<Page<T>> {
    const response = await this.#get(path, query);
    const items = (await response.json()) as T[];
    const total = Number(response.headers.get("Fiken-Api-Result-Count") ?? Number.NaN);
    return { items, total: Number.isFinite(total) ? total : undefined };
  }

  async #get(path: string, query: Record<string, QueryValue>): Promise<Response> {
    const response = await this.#transport.send({
      method: "GET",
      path: withQuery(path, query),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new FikenApiError(response.status, await readFikenMessage(response));
    return response;
  }
}

/** Builds a path from a template such as `/companies/{companySlug}/contacts/{contactId}`, encoding every parameter. */
export function fikenPath(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter: ${name}`);
    return encodeURIComponent(String(value));
  });
}

function withQuery(path: string, query: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  // URLSearchParams writes spaces as "+"; Fiken documents "%20" (for example `sortBy=name%20asc`).
  const qs = search.toString().replace(/\+/g, "%20");
  return qs ? `${path}?${qs}` : path;
}
