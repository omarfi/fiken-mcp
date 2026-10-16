# @fiken-mcp/cloudflare

The Cloudflare Worker that runs Fiken MCP at `https://fiken.mcp.wollums.no/mcp`. It adds what `packages/core` leaves to the platform: OAuth for MCP clients, the Fiken sign-in, one queue per Fiken user, and upload links. See [packages/core/README.md](../../packages/core/README.md) for the part that does not depend on Cloudflare.

## How it fits together

| Route | Handled by | What happens |
| --- | --- | --- |
| `/.well-known/oauth-*` | `@cloudflare/workers-oauth-provider` | OAuth and protected-resource metadata. |
| `GET /authorize` | `src/auth/handlers.ts` | Refuses clients outside the allowlist, then shows the consent page (read only, or read and write). Nothing goes to Fiken yet. |
| `POST /authorize` | `src/auth/handlers.ts` | Records the choice as a scope (`fiken:read` or `fiken:write`) and sends the user to Fiken with PKCE. |
| `GET /callback` | `src/auth/handlers.ts` | Exchanges Fiken's code, reads `GET /user`, and issues our grant. Fiken's tokens go in the grant's encrypted props. |
| `POST /token` | `src/index.ts`, then the library | Refuses clients outside the allowlist before the library fetches their metadata. Refreshes Fiken's tokens when ours are refreshed (`src/auth/token-exchange.ts`). |
| `/mcp` | `src/mcp.ts` | Our access token is checked by the library. Then core's `handleMcpRequest`, with every Fiken call sent through the user's queue. |
| `/upload/:token` | `src/upload.ts` | One-time upload page. The file goes to Fiken through the user's queue. |
| `/` | `src/index.ts` | A short landing page. |

`FikenUserQueue` (`src/queue.ts`) is a Durable Object per Fiken user, named by an HMAC of the user's e-mail keyed with `FIKEN_CLIENT_SECRET`. It runs core's `FikenScheduler`, so a user never has more than one call to Fiken at a time, and it refreshes Fiken tokens single-flight, since Fiken may rotate the refresh token.

Only Claude and ChatGPT may connect: client IDs must be Client ID Metadata Documents under `https://claude.ai/oauth/` or `https://chatgpt.com/oauth/` (`src/config.ts`). There is no dynamic client registration.

### Token lifetimes

| Token | Lifetime |
| --- | --- |
| Our access token | At most 1 hour, and ends 5 minutes before Fiken's access token. |
| Our refresh token | 30 days, and 30 days without use. |
| Fiken's access token | About 24 hours. Refreshed when our token is refreshed and Fiken's has less than 2 hours left. |

If Fiken refuses the refresh token (`invalid_grant`), our refresh fails with `invalid_grant`, and the user must connect again.

## Setting up a new deployment

These steps are for running your own copy. The production deployment already exists.

### 1. Fiken OAuth app

From Fiken's API documentation (the introduction in `spec/fiken-openapi.yaml`):

1. In Fiken, tick the developer box under **Rediger konto → Profil → Andre innstillinger**.
2. Create an app under the **API** tab in Brukerinnstillinger, with the redirect URI `https://<your domain>/callback`.
3. Note the client ID and client secret.

A new app works for up to 5 users. Production status is requested from <api@fiken.no>, after 2 to 3 real users have used the integration. Every company also needs Fiken's API module, except test companies that are not registered in Brønnøysund.

### 2. Your domain and name

- `src/config.ts`: `PUBLIC_ORIGIN`. The MCP address, the redirect URI and the metadata follow from it.
- `wrangler.jsonc`: the `routes` pattern. It is a Custom Domain, so the domain's zone must be in the same Cloudflare account.
- `packages/core/src/server-info.ts`: `SERVER_DISPLAY_NAME`, shown on the consent and upload pages and sent as the server title.

### 3. Cloudflare resources

Run from `apps/cloudflare`:

```bash
pnpm exec wrangler login
```

```bash
pnpm exec wrangler kv namespace create OAUTH_KV
```

Put the namespace ID it prints in `wrangler.jsonc` under `kv_namespaces`. The Durable Object needs no command: the first deploy creates it from the `v1` migration (`new_sqlite_classes`).

### 4. Secrets

From `apps/cloudflare`, one at a time. Wrangler asks for the value, so it never appears in the shell history:

```bash
pnpm exec wrangler secret put FIKEN_CLIENT_ID
```

```bash
pnpm exec wrangler secret put FIKEN_CLIENT_SECRET
```

Never put the values in the repository. For local development they go in `apps/cloudflare/.dev.vars` (copy `.dev.vars.example`), which git ignores.

### 5. Deploy

See [Deploying](#deploying).

## Deploying

Deploy from a clean checkout of `main`, never from a working copy on another branch: `wrangler deploy` uploads whatever is on disk.

```bash
git fetch origin && git worktree add --detach ../fiken-mcp-deploy origin/main
```

```bash
cd ../fiken-mcp-deploy && pnpm install && pnpm check && pnpm run deploy
```

Remove the copy afterwards with `git worktree remove ../fiken-mcp-deploy`.

Use `pnpm run deploy`, not `pnpm deploy`, which is a built-in pnpm command.

Then check that the Worker answers:

```bash
curl -s https://fiken.mcp.wollums.no/.well-known/oauth-protected-resource/mcp
```

It should return the resource `https://fiken.mcp.wollums.no/mcp`. A `POST /mcp` without a token should give `401` with a `WWW-Authenticate` header that points to that document.

Test new or changed tools in a new conversation in claude.ai. A conversation that is already open, and a running Claude Code session, keep the tool list they started with.

`pnpm exec wrangler deployments list` shows what is live. `pnpm exec wrangler rollback` goes back to the previous version.

## Logs

Workers Logs keeps our own log lines (`src/log.ts`): JSON with an `event` field and metadata only, never tokens, e-mail addresses or accounting data. Invocation logs are off in `wrangler.jsonc`, because request URLs carry upload tokens and OAuth codes.

Follow them live from `apps/cloudflare`:

```bash
pnpm exec wrangler tail fiken-mcp --format json
```

| Event | Meaning |
| --- | --- |
| `tool_call` | One tool call: tool, company, outcome, Fiken status, duration, access level. |
| `mcp_error` | An unexpected error in a tool. Only the error's name is logged. |
| `consent_approved`, `grant_issued` | A user approved access and got a grant. |
| `client_not_allowed` | A client outside the allowlist tried to connect. |
| `fiken_sign_in_declined`, `fiken_sign_in_failed` | The Fiken sign-in was cancelled or failed. |
| `fiken_refresh_failed` | Fiken refused or failed a token refresh. |
| `oauth_error`, `authorization_error`, `cimd_fetch_failed` | Errors in the OAuth flow. |
| `upload_link_issued`, `upload_done`, `upload_failed` | Upload links. |
| `queue_retry`, `queue_breaker_open`, `queue_breaker_rejected`, `queue_outcome_unknown` | The queue retried a call, stopped calls after repeated 429s, refused a call while stopped, or lost a write whose outcome is unknown. |

## Storage

- **KV (`OAUTH_KV`)**: the OAuth library's grants, codes and tokens. The library stores tokens, codes and secrets only as hashes, and encrypts the grant props, where Fiken's tokens are, with a key only the token holder can unwrap (see the library's `storage-schema.md`). Upload links are under the prefix `upload:`: only a SHA-256 of the token, and the record encrypted with AES-GCM under a key derived from the token. Links expire after 15 minutes and are deleted when used.
- **Durable Object storage**: each `FikenUserQueue` stores only when its circuit breaker opens again.

## Things to know before changing something

- **Rotating `FIKEN_CLIENT_SECRET`** also changes the key that names each user's queue, because the key is an HMAC with the secret. Grants issued before the rotation keep the old key until the user connects again. A user with both an old and a new grant can then have two queues, and so two concurrent calls to Fiken.
- **The allowlist** of MCP clients is in `src/config.ts`. A new client must use a Client ID Metadata Document on a domain the client controls.
- **`global_fetch_strictly_public`** in `wrangler.jsonc` must stay. It stops the metadata-document fetches from using same-zone origin routing (SSRF protection), and without it the OAuth library stops advertising Client ID Metadata Documents, so Claude and ChatGPT cannot connect.
- **New Durable Object classes** need a new migration tag in `wrangler.jsonc`.

## Local development

From `apps/cloudflare`:

```bash
pnpm exec wrangler dev --local-protocol https
```

This starts the Worker with local KV and Durable Objects, using `apps/cloudflare/.dev.vars`. Over plain HTTP (`pnpm dev`) the protected-resource metadata did not show, so serve HTTPS. The public origin and the redirect URI are fixed in `src/config.ts`, so a full Fiken sign-in locally needs a Fiken app with a local redirect URI and a local origin.

`pnpm test` in this package runs the tests for upload links and the OAuth guards, without network.
