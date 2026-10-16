import { GrantType, OAuthError, type TokenExchangeCallbackOptions, type TokenExchangeCallbackResult } from "@cloudflare/workers-oauth-provider";
import { log } from "../log.ts";
import { accessProps, type FikenTokens, type GrantProps } from "./props.ts";

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
    return { accessTokenProps: accessProps(props), accessTokenTTL: accessTokenTtl(props.fiken) };
  }

  if (options.grantType === GrantType.REFRESH_TOKEN) {
    if (secondsLeft(props.fiken) > FIKEN_REFRESH_THRESHOLD) {
      return { accessTokenProps: accessProps(props), accessTokenTTL: accessTokenTtl(props.fiken) };
    }
    // In the user's FikenUserQueue, so concurrent refreshes share one call to Fiken (refresh tokens may rotate).
    const queue = options.env.FIKEN_USER_QUEUE.get(options.env.FIKEN_USER_QUEUE.idFromName(props.queueKey));
    const result = await queue.refreshFiken(props.fiken.refreshToken);
    if (!result.ok) {
      log("fiken_refresh_failed", { error: result.error, reason: result.reason });
      if (result.error === "invalid_grant") throw new OAuthError("invalid_grant", { description: "Fiken access was revoked or has expired" });
      throw new OAuthError("temporarily_unavailable", {
        description: "Fiken is unavailable",
        statusCode: 503,
        headers: { "Retry-After": result.retryAfter ?? "30" },
      });
    }
    const newProps: GrantProps = { ...props, fiken: result.tokens };
    return { newProps, accessTokenProps: accessProps(newProps), accessTokenTTL: accessTokenTtl(result.tokens) };
  }

  // Token exchange is not enabled; never allow it across clients should it ever be.
  return { allowCrossClientExchange: false };
}

function secondsLeft(tokens: FikenTokens): number {
  return tokens.expiresAt - Math.floor(Date.now() / 1000);
}

function accessTokenTtl(tokens: FikenTokens): number {
  return Math.max(60, Math.min(MAX_ACCESS_TOKEN_TTL, secondsLeft(tokens) - EXPIRY_MARGIN));
}
