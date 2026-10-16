// Secrets and runtime bindings that `wrangler types` cannot see.
interface Env {
  /** Fiken OAuth app. Set with `wrangler secret put`. */
  FIKEN_CLIENT_ID: string;
  FIKEN_CLIENT_SECRET: string;
  /** Injected by OAuthProvider into every handler's env. */
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}
