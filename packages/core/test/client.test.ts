import { describe, expect, it } from "vitest";
import { createdId, FikenClient, resultCount } from "../src/fiken/client.ts";
import { FikenApiError } from "../src/fiken/errors.ts";
import { json, MockTransport } from "./helpers.ts";

describe("FikenClient", () => {
  it("sends paths relative to /api/v2 with encoded path parameters and a %20-encoded query", async () => {
    const transport = new MockTransport(() => json({}));
    const fiken = new FikenClient(transport);
    await fiken.api.GET("/companies/{companySlug}/contacts", {
      params: { path: { companySlug: "a/b?c" }, query: { name: "Ola Nordmann", pageSize: 20 } },
    });
    expect(transport.requests[0]).toMatchObject({
      method: "GET",
      path: "/companies/a%2Fb%3Fc/contacts?name=Ola%20Nordmann&pageSize=20",
      headers: { accept: "application/json" },
    });
  });

  it("refuses a missing or empty path parameter instead of calling Fiken", async () => {
    const transport = new MockTransport(() => json({}));
    const fiken = new FikenClient(transport);
    await expect(
      fiken.api.GET("/companies/{companySlug}/contacts/{contactId}", {
        params: { path: { companySlug: "x", contactId: undefined as unknown as number } },
      }),
    ).rejects.toThrow("contactId");
    await expect(fiken.api.GET("/companies/{companySlug}", { params: { path: { companySlug: "" } } })).rejects.toThrow(
      "companySlug",
    );
    expect(transport.requests).toHaveLength(0);
  });

  it("refuses dot segments, which URL parsing would turn into a different path", async () => {
    const transport = new MockTransport(() => json({}));
    const fiken = new FikenClient(transport);
    for (const value of [".", ".."]) {
      await expect(fiken.api.GET("/companies/{companySlug}/accounts/{accountCode}", { params: { path: { companySlug: "x", accountCode: value } } })).rejects.toThrow(
        "Invalid path parameter",
      );
    }
    expect(transport.requests).toHaveLength(0);
  });

  it("sends JSON bodies and returns the created ID from Location", async () => {
    const transport = new MockTransport(
      () =>
        new Response(null, {
          status: 201,
          headers: { location: "https://api.fiken.no/api/v2/companies/x/contacts/123", "content-length": "0" },
        }),
    );
    const fiken = new FikenClient(transport);
    const { data, response } = await fiken.api.POST("/companies/{companySlug}/contacts", {
      params: { path: { companySlug: "x" } },
      body: { name: "Ola Nordmann", customer: true, supplier: false },
    });
    expect(data).toBeUndefined();
    expect(createdId(response)).toBe("123");
    const request = transport.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.headers?.["content-type"]).toBe("application/json");
    expect(new TextDecoder().decode(request?.body as ArrayBuffer)).toBe('{"name":"Ola Nordmann","customer":true,"supplier":false}');
  });

  it("throws FikenApiError with Fiken's message on errors", async () => {
    const fiken = new FikenClient(new MockTransport(() => json({ message: "Kontoen 3000 finnes ikke" }, { status: 400 })));
    const error = await fiken.api.GET("/companies").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FikenApiError);
    expect((error as FikenApiError).status).toBe(400);
    expect((error as FikenApiError).message).toContain("Kontoen 3000 finnes ikke");
  });

  it("warns that a write with a 5xx may have been executed", async () => {
    const fiken = new FikenClient(new MockTransport(() => json({}, { status: 502 })));
    const write = await fiken.api
      .POST("/companies/{companySlug}/contacts", { params: { path: { companySlug: "x" } }, body: { name: "A", customer: true, supplier: false } })
      .catch((caught: unknown) => caught);
    expect((write as Error).message).toContain("find_*");
    const read = await fiken.api.GET("/companies").catch((caught: unknown) => caught);
    expect((read as Error).message).not.toContain("find_*");
  });

  it("reads the total count from Fiken's pagination headers", () => {
    expect(resultCount(new Response(null, { headers: { "Fiken-Api-Result-Count": "42" } }))).toBe(42);
    expect(resultCount(new Response(null))).toBeUndefined();
  });
});
