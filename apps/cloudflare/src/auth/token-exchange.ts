import { GrantType, type TokenExchangeCallbackOptions, type TokenExchangeCallbackResult } from "@cloudflare/workers-oauth-provider";
import { refreshTokens } from "./fiken-oauth.ts";
import type { FikenTokens, GrantProps } from "./props.ts";

const MAX_ACCESS_TOKEN_TTL = 60 * 60;
/** Our access token must expire this long before Fiken's, so a tool call never meets an expired Fiken token. */
const EXPIRY_MARGIN = 5 * 60;
/** Refresh Fiken's token on our refresh only when it has less than this left. Fiken's lasts about 24 hours. */
const FIKEN_REFRESH_THRESHOLD = 2 * 60 * 60;

/**
 * Runs when the MCP client exchanges a code or refreshes our token. This is where Fiken's tokens
 * are renewed: the MCP request path never refreshes them.
 */
export async function tokenExchangeCallback(
  options: TokenExchangeCallbackOptions<Env>,
): Promise<TokenExchangeCallbackResult | undefined> {
  const props = options.props as GrantProps;

  if (options.grantType === GrantType.AUTHORIZATION_CODE) {
    return { accessTokenTTL: accessTokenTtl(props.fiken) };
  }

  if (options.grantType === GrantType.REFRESH_TOKEN) {
    if (secondsLeft(props.fiken) > FIKEN_REFRESH_THRESHOLD) {
      return { accessTokenTTL: accessTokenTtl(props.fiken) };
    }
    const fiken = await refreshTokens(options.env, props.fiken);
    return { newProps: { ...props, fiken } satisfies GrantProps, accessTokenTTL: accessTokenTtl(fiken) };
  }

  return undefined;
}

function secondsLeft(tokens: FikenTokens): number {
  return tokens.expiresAt - Math.floor(Date.now() / 1000);
}

function accessTokenTtl(tokens: FikenTokens): number {
  return Math.max(60, Math.min(MAX_ACCESS_TOKEN_TTL, secondsLeft(tokens) - EXPIRY_MARGIN));
}
