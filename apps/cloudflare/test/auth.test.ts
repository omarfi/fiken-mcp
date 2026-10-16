import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshTokens } from "../src/auth/fiken-oauth.ts";
import { tokenClientId } from "../src/auth/token-guard.ts";

const env = { FIKEN_CLIENT_ID: "id", FIKEN_CLIENT_SECRET: "secret" } as unknown as Env;

describe("tokenClientId", () => {
  const token = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://fiken.mcp.wollums.no/token", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });

  it("reads client_id from the form, Basic auth, or a client assertion's issuer", async () => {
    expect(await tokenClientId(token("grant_type=refresh_token&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fx"))).toBe("https://claude.ai/oauth/x");
    expect(await tokenClientId(token("grant_type=refresh_token", { authorization: `Basic ${btoa("https://evil.example/c:secret")}` }))).toBe("https://evil.example/c");
    const assertion = `e30.${btoa(JSON.stringify({ iss: "https://chatgpt.com/oauth/client.json" }))}.sig`;
    expect(await tokenClientId(token(`client_assertion=${encodeURIComponent(assertion)}`))).toBe("https://chatgpt.com/oauth/client.json");
    expect(await tokenClientId(token("grant_type=refresh_token"))).toBeUndefined();
  });
});

describe("refreshTokens", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", () => Promise.resolve(Response.json(body, { status })));

  it("treats only Fiken's invalid_grant as lost access", async () => {
    answer(400, { error: "invalid_grant" });
    expect(await refreshTokens(env, "r")).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("does not sign users out when our client credentials are rejected or Fiken is down", async () => {
    answer(401, { error: "invalid_client" });
    expect(await refreshTokens(env, "r")).toMatchObject({ ok: false, error: "temporarily_unavailable", reason: "invalid_client" });
    answer(503, {});
    expect(await refreshTokens(env, "r")).toMatchObject({ ok: false, error: "temporarily_unavailable" });
  });

  it("keeps the old refresh token when Fiken does not rotate it", async () => {
    answer(200, { access_token: "a2", expires_in: 86_000 });
    expect(await refreshTokens(env, "r1")).toMatchObject({ ok: true, tokens: { accessToken: "a2", refreshToken: "r1" } });
  });
});
