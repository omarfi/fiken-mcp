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
  /** Name of this user's FikenUserQueue: SHA-256 of the normalized Fiken e-mail, since Fiken exposes no user ID. */
  queueKey: string;
  fiken: FikenTokens;
}

export function scopesFor(access: AccessLevel): string[] {
  return access === "write" ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];
}

/** Fails closed: anything but an explicit write scope is read-only. */
export function accessFromScopes(scopes: readonly string[] | undefined): AccessLevel {
  return scopes?.includes(SCOPE_WRITE) ? "write" : "read";
}

export async function queueKeyFor(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
