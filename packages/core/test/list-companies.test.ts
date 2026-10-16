import { describe, expect, it } from "vitest";
import { connect, json, MockTransport } from "./helpers.ts";

const company = (overrides: Record<string, unknown>) => ({
  name: "Wollum AS",
  slug: "wollum-as",
  organizationNumber: "912345678",
  vatType: "yes",
  hasApiAccess: true,
  testCompany: false,
  ...overrides,
});

describe("list_companies", () => {
  it("asks Fiken for up to 100 companies sorted by name", async () => {
    const transport = new MockTransport(() => json([]));
    const client = await connect(transport);
    await client.callTool({ name: "list_companies", arguments: {} });
    expect(transport.requests).toEqual([
      { method: "GET", path: "/companies?page=0&pageSize=100&sortBy=name%20asc", headers: { accept: "application/json" } },
    ]);
  });

  it("returns name, slug and organization number", async () => {
    const transport = new MockTransport(() => json([company({})], { headers: { "Fiken-Api-Result-Count": "1" } }));
    const client = await connect(transport);
    const result = await client.callTool({ name: "list_companies", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      companies: [{ name: "Wollum AS", slug: "wollum-as", organizationNumber: "912345678", testCompany: false, hasApiAccess: true }],
    });
  });

  it("warns about companies without the API add-on, but not test companies", async () => {
    const transport = new MockTransport(() =>
      json([company({ hasApiAccess: false }), company({ slug: "test", hasApiAccess: false, testCompany: true })]),
    );
    const client = await connect(transport);
    const result = await client.callTool({ name: "list_companies", arguments: {} });
    expect((result.structuredContent as { notes: string[] }).notes).toEqual([
      expect.stringContaining("API-tillegg"),
    ]);

    const onlyTest = await connect(new MockTransport(() => json([company({ hasApiAccess: false, testCompany: true })])));
    const testResult = await onlyTest.callTool({ name: "list_companies", arguments: {} });
    expect(testResult.structuredContent).not.toHaveProperty("notes");
  });

  it("explains how to grant access when no company is shared", async () => {
    const client = await connect(new MockTransport(() => json([])));
    const result = await client.callTool({ name: "list_companies", arguments: {} });
    expect((result.structuredContent as { notes: string[] }).notes[0]).toContain("Apper du har gitt tilgang til");
  });

  it("turns a Fiken error into a Norwegian tool error", async () => {
    const client = await connect(new MockTransport(() => json({ message: "nope" }, { status: 403 })));
    const result = await client.callTool({ name: "list_companies", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("Ingen tilgang i Fiken") }]);
  });
});
