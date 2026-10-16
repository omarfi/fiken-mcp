import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { FIKEN_API_BASE, FIKEN_AUTHORIZE_URL, FIKEN_REDIRECT_URI, FIKEN_TOKEN_URL } from "../config.ts";
import type { FikenTokens } from "./props.ts";

// Claude allows 10 seconds for /token, 30 for refresh. Leave room for our own work.
const FIKEN_TIMEOUT_MS = 8_000;

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export async function createPkce(): Promise<PkcePair> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function fikenAuthorizeUrl(env: Env, state: string, codeChallenge: string): string {
  const url = new URL(FIKEN_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: env.FIKEN_CLIENT_ID,
    redirect_uri: FIKEN_REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeCode(env: Env, code: string, state: string, verifier: string): Promise<FikenTokens> {
  const response = await tokenRequest(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: FIKEN_REDIRECT_URI,
    state,
    code_verifier: verifier,
  });
  if (!response.ok) throw new Error(`Fiken code exchange failed with ${response.status}`);
  return toTokens(await response.json(), undefined);
}

/**
 * Refreshes Fiken tokens from inside `tokenExchangeCallback`. Throws `OAuthError` so the provider
 * answers the MCP client correctly: `invalid_grant` revokes our grant (the user must sign in
 * again), `temporarily_unavailable` keeps it for a retry.
 */
export async function refreshTokens(env: Env, tokens: FikenTokens): Promise<FikenTokens> {
  let response: Response;
  try {
    response = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  } catch {
    throw new OAuthError("temporarily_unavailable", { description: "Fiken is not responding", statusCode: 503 });
  }
  if (response.status === 400 || response.status === 401) {
    throw new OAuthError("invalid_grant", { description: "Fiken access was revoked or has expired" });
  }
  if (!response.ok) {
    throw new OAuthError("temporarily_unavailable", {
      description: "Fiken is unavailable",
      statusCode: 503,
      headers: { "Retry-After": response.headers.get("retry-after") ?? "30" },
    });
  }
  // Fiken may rotate the refresh token. Keep the old one only if it sent none.
  return toTokens(await response.json(), tokens.refreshToken);
}

export interface FikenUser {
  name: string;
  email: string;
}

/** The only Fiken call outside FikenUserQueue: the queue is keyed by the e-mail this returns. */
export async function fetchUser(accessToken: string): Promise<FikenUser> {
  const response = await fetch(`${FIKEN_API_BASE}/user`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "x-request-id": crypto.randomUUID() },
    signal: AbortSignal.timeout(FIKEN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Fiken /user failed with ${response.status}`);
  const user = await response.json<Partial<FikenUser>>();
  if (typeof user.email !== "string" || !user.email) throw new Error("Fiken /user returned no e-mail");
  return { name: user.name ?? "", email: user.email };
}

function tokenRequest(env: Env, params: Record<string, string>): Promise<Response> {
  return fetch(FIKEN_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.FIKEN_CLIENT_ID}:${env.FIKEN_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(FIKEN_TIMEOUT_MS),
  });
}

function toTokens(body: unknown, previousRefreshToken: string | undefined): FikenTokens {
  const token = body as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  const refreshToken = typeof token.refresh_token === "string" && token.refresh_token ? token.refresh_token : previousRefreshToken;
  if (typeof token.access_token !== "string" || !refreshToken || typeof token.expires_in !== "number") {
    throw new Error("Fiken token response is missing fields");
  }
  return {
    accessToken: token.access_token,
    refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + token.expires_in,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
