import type { AccessLevel } from "@fiken-mcp/core";
import { SCOPE_READ, SCOPE_WRITE } from "../config.ts";

export interface FikenTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds since the Unix epoch. */
  expiresAt: number;
}

/** Stored encrypted in the grant. Only a holder of one of our tokens can decrypt it. */
export interface GrantProps {
  /** Name of this user's FikenUserQueue: an HMAC of the normalized Fiken e-mail, since Fiken exposes no user ID. */
  queueKey: string;
  fiken: FikenTokens;
}

/** What each access token carries: no Fiken refresh token, which stays in the grant. */
export interface AccessProps {
  queueKey: string;
  fiken: { accessToken: string; expiresAt: number };
}

export function accessProps(props: GrantProps): AccessProps {
  return { queueKey: props.queueKey, fiken: { accessToken: props.fiken.accessToken, expiresAt: props.fiken.expiresAt } };
}

export function scopesFor(access: AccessLevel): string[] {
  return access === "write" ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];
}

/** Fails closed: anything but an explicit write scope is read-only. */
export function accessFromScopes(scopes: readonly string[] | undefined): AccessLevel {
  return scopes?.includes(SCOPE_WRITE) ? "write" : "read";
}

/**
 * An HMAC of the normalized e-mail, keyed with our Fiken client secret, so the key is not a
 * guessable pseudonym of the e-mail. It names the user's FikenUserQueue and the grant's user ID.
 */
export async function queueKeyFor(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`queue-key:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
