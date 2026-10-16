import type { Client } from "@modelcontextprotocol/client";
import { beforeAll, describe, expect, it } from "vitest";
import { call, liveClient, liveTransport, TEST_COMPANY, testToken } from "./live.ts";

// The gateway against the test company. Run with `pnpm test:integration`.

const token = testToken();

describe.skipIf(!token)("gateway against the test company", () => {
  let client: Client;

  beforeAll(async () => {
    client = await liveClient(token ?? "");
  });

  async function raw<T>(path: string): Promise<T> {
    const response = await liveTransport(token ?? "").send({ method: "GET", path: `/companies/${TEST_COMPANY}${path}` });
    return (await response.json()) as T;
  }

  it("explore_api lists the areas", async () => {
    const { areas } = await call<{ areas: { area: string }[] }>(client, "explore_api");
    expect(areas.map((row) => row.area)).toEqual(expect.arrayContaining(["offers", "projects", "time entries"]));
  });

  it("read_api reads the company and an account", async () => {
    const company = await call<{ data: { slug: string } }>(client, "read_api", { operation_id: "getCompany" });
    expect(company.data.slug).toBe(TEST_COMPANY);
    const account = await call<{ data: { code: string } }>(client, "read_api", { operation_id: "getAccount", params: { accountCode: 3000 } });
    expect(account.data.code).toBe("3000");
  });

  it("read_api encodes a sub-ledger account in the path and converts the balance to kroner", async () => {
    const expected = await raw<{ balance: number }>("/accountBalances/1920%3A10001?date=2026-10-16");
    const result = await call<{ data: { code: string; balance: number } }>(client, "read_api", {
      operation_id: "getAccountBalance",
      params: { accountCode: "1920:10001", date: "2026-10-16" },
    });
    expect(result.data).toMatchObject({ code: "1920:10001", balance: expected.balance / 100 });
  });

  it("read_api converts amounts at any depth", async () => {
    const expected = await raw<{ entries: { lines: { amount: number }[] }[] }[]>("/transactions?page=0&pageSize=3");
    const result = await call<{ data: { entries: { lines: { amount: number }[] }[] }[] }>(client, "read_api", {
      operation_id: "getTransactions",
      limit: 3,
    });
    expect(result.data.map((t) => t.entries.map((e) => e.lines.map((l) => l.amount)))).toEqual(
      expected.map((t) => t.entries.map((e) => e.lines.map((l) => l.amount / 100))),
    );
  });

  it("read_api lists offers and groups", async () => {
    const offers = await call<{ data: unknown[] }>(client, "read_api", { operation_id: "getOffers" });
    expect(Array.isArray(offers.data)).toBe(true);
    const groups = await call<{ data: unknown[] }>(client, "read_api", { operation_id: "getGroups" });
    expect(Array.isArray(groups.data)).toBe(true);
  });

  it("read_api explains a module that is not activated", async () => {
    const result = await client.callTool({ name: "read_api", arguments: { company: TEST_COMPANY, operation_id: "getProjects" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("modul som ikke er aktivert");
  });
});
