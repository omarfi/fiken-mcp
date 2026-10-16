import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { SERVER_DISPLAY_NAME } from "@fiken-mcp/core";
import { finishSignIn, showConsent, submitConsent } from "./auth/handlers.ts";
import { tokenExchangeCallback } from "./auth/token-exchange.ts";
import { MCP_RESOURCE, SCOPE_READ, SCOPE_WRITE } from "./config.ts";
import { log } from "./log.ts";
import { mcpHandler } from "./mcp.ts";
import { escapeHtml, htmlPage, messagePage } from "./ui/page.ts";

export { FikenUserQueue } from "./queue.ts";

const THIRTY_DAYS = 30 * 24 * 60 * 60;

/** Unprotected routes: the consent flow and a short landing page. */
const appHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (pathname === "/authorize" && method === "GET") return showConsent(request, env);
    if (pathname === "/authorize" && method === "POST") return submitConsent(request, env);
    if (pathname === "/callback" && method === "GET") return finishSignIn(request, env);
    if (pathname === "/" && method === "GET") return landingPage();

    return messagePage(404, "Fant ikke siden", "Adressen finnes ikke.");
  },
};

function landingPage(): Response {
  return htmlPage({
    title: "MCP-server for Fiken",
    body: `<section class="card">
<h1>${escapeHtml(SERVER_DISPLAY_NAME)}</h1>
<p>Koble Claude eller ChatGPT til regnskapet ditt i Fiken. Legg til denne adressen som connector, og logg inn med Fiken:</p>
<dl><div><dt>Adresse</dt><dd>${escapeHtml(MCP_RESOURCE)}</dd></div></dl>
</section>`,
  });
}

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: appHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  // No dynamic client registration: Claude and ChatGPT use Client ID Metadata Documents.
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [SCOPE_READ, SCOPE_WRITE],
  resourceMetadata: { resource: MCP_RESOURCE, resource_name: SERVER_DISPLAY_NAME },
  refreshTokenTTL: THIRTY_DAYS,
  refreshTokenIdleTTL: THIRTY_DAYS,
  tokenExchangeCallback,
  onError: ({ code, status, internal }) => {
    log("oauth_error", { code, status, category: internal.category, reason: internal.reason });
  },
});
