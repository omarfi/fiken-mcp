# CLAUDE.md — conventions for coding sessions in Fiken MCP

Fiken MCP: a hosted MCP server that connects Claude and ChatGPT to Fiken
(Norwegian accounting software) through Fiken OAuth. The user adds one URL,
signs in with Fiken, and needs no API key. Open source under Apache-2.0 by
Wollum AS, not affiliated with Fiken AS. The long-term goal is that Fiken takes
over `packages/core` and runs it in their own stack.

**The specification is [docs/HANDOFF.md](docs/HANDOFF.md)**, in Norwegian. Read
sections 3 (locked decisions), 5 (auth and security), 6 (Fiken client and
queue), 7 (tools), 9 (open questions and findings) and 10 (milestones) before
writing code. Fiken's OpenAPI spec in `spec/fiken-openapi.yaml` is the source
of truth for fields and paths.

## Instructions

**Start every message with my name, Adrian.** No exceptions.

**About Adrian.** Founder of Wollum AS. **Reply in Norwegian (bokmål)**, even
though everything in the repository is in English. Be short and precise, and
ask one question at a time. When there are several good solutions, present the
options with pros and cons and ask before writing code, unless he says «velg
selv». Explain new concepts briefly, adapted to his experience:

| Experience | Technology |
| -- | -- |
| Competent, not expert | TypeScript |
| Medium | Cloudflare Workers, Durable Objects, KV |
| Good | MCP, Claude, Python, Vercel |

**No attribution lines in commits or PRs.** No `Co-authored-by: Claude`, no
"Generated with Claude Code", no mention of the tool of any kind — neither in
the commit message nor in the PR description.

**Check a claim against its primary source before writing it down.** Fiken's
OpenAPI spec and docs for the API, the MCP specification for the protocol,
Cloudflare's docs and the library source for Workers and
`workers-oauth-provider`, Anthropic's and OpenAI's connector docs for client
behaviour, and the open API of the Brønnøysund Register Centre for
counterparties. Our own documents are claims until they are checked.

**Measure, do not assume.** Versions, defaults, headers and response shapes are
measured against the real package, the spec or the test company, and what was
written is read back.

**Secrets are typed by Adrian.** Claude writes the commands
(`wrangler secret put …`, `wrangler login`), one per line, and never runs them
with a secret value itself. No secret ever appears in chat or in the
repository; local values live in `.dev.vars` (gitignored).

**Outward-facing actions need a yes in chat:** creating Cloudflare resources,
deploying, and anything that writes to a real Fiken company. The test company
is the only Fiken company Claude writes to, and `send_document` only ever sends
to Adrian's own address.

**Final reports are short**, in three parts: **Gjort** — what was done and the
most important finding. **Nå** — what remains. **Du** — one question for
Adrian. The rest on request — the details are in the diff.

## Decisions

- **The locked decisions in HANDOFF section 3 are not reopened** without a
  concrete technical reason.
- **Answers to the open questions** (HANDOFF section 9) are written into
  HANDOFF as they are verified, with the source.
- **New decisions are proposed in chat first** and written into HANDOFF only
  after Adrian agrees.
- **One milestone at a time** (HANDOFF section 10). Show the result before
  moving on.

## Git flow

- **Until the system is finished (M8 done), commit and push directly to
  `main`.** After that, every change goes through a branch and a pull request.
- **Run `pnpm check` before every commit.** CI runs the same checks on `main`.
- Commit messages are in English, imperative, and refer to the milestone.

## Language

- **Everything in the repository is in English:** code, identifiers, comments,
  file names, commit messages and this file. Identifiers never contain æ, ø
  or å.
- **The exception is text users see, in Norwegian (bokmål):** tool titles and
  descriptions, error messages returned to the model, the consent page, the
  upload page and the README. HANDOFF.md is in Norwegian because it is
  Adrian's document.
- **Never emojis**, anywhere.

## Architecture rules

- **`packages/core` never imports Cloudflare APIs** (enforced by ESLint). It
  holds the Fiken client, the tools, the MCP server and the instructions, and
  depends only on web-standard APIs, `@modelcontextprotocol/server` and `zod`.
  The platform implements its interfaces (`FikenTransport` and friends).
- **The MCP layer is stateless**: MCP SDK v2 `createMcpHandler`, a fresh
  `McpServer` per request, serving both the 2026-07-28 protocol and 2025-era
  clients. No `agents` package, no `McpAgent`.
- **Every call to Fiken goes through `FikenUserQueue`** (one Durable Object per
  Fiken user, keyed by a hash of the e-mail, because `GET /user` has no ID). At
  most one concurrent request and 4 per second. The only exception is
  `GET /user` during sign-in, before the key is known.
- **Never retry a write automatically on timeout or 5xx.** A 429 means the call
  was not executed, so retrying it is safe.
- **Amounts: øre to Fiken, kroner in the tools.** All conversion in
  `core/src/money.ts`.
- **`PUT` is a full replacement:** fetch, merge, write. Read back after every
  write (the `Location` header points to the new resource).
- **Generated files are never edited by hand:** `core/src/fiken/types.gen.ts`
  comes from `pnpm gen:types`.
- **Relative imports in core use the `.ts` extension**, and only erasable
  syntax (no enums, namespaces or parameter properties), so core runs directly
  in Node.

## Tools

- **Annotations on every tool.** Reads: `readOnlyHint: true`. Reversible
  writes: `destructiveHint: false`. Bookkeeping, deletion and sending:
  `destructiveHint: true`. Reads, reversible writes and bookkeeping are never in
  the same tool.
- **Rules the model must follow live in the tool descriptions too**, not only in
  the server instructions, because claude.ai web and Desktop do not pass
  `instructions` to the model.
- **Write tools are registered only for grants with write access.**
- Default 20 rows, maximum 100. Typical responses stay under about 3,000 tokens.

## Security

- **Only Claude and ChatGPT may connect**, through Client ID Metadata Documents
  from `https://claude.ai/oauth/` and `https://chatgpt.com/oauth/`. No dynamic
  client registration.
- **The consent page is shown before every redirect to Fiken**, built on the
  `workers-oauth-provider` consent and upstream helpers, never on hand-rolled
  cookies or state.
- **MCP clients only ever get our tokens**, never Fiken's. Fiken tokens live in
  the encrypted grant props.
- **Path parameters are always `encodeURIComponent`-ed.** The gateway builds
  calls only from the generated allowlist, never from a free URL, and only
  `GET`.
- **Logs carry metadata only** (tool, company, status, duration), never
  accounting data or tokens.

## Commands

- `pnpm check` runs `pnpm build`, `pnpm lint` and `pnpm test`.
- `pnpm dev` starts the Worker locally. `pnpm run deploy` deploys (not
  `pnpm deploy`, which is a built-in pnpm command).
- `pnpm spec:update` fetches the latest spec and regenerates the types.
- Run `pnpm install` first in a new worktree.
