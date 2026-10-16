import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { escapeHtml, htmlPage } from "./page.ts";

/**
 * The consent page shown before every redirect to Fiken. It shows what MCP's security best
 * practices require: the client's name and verified domain, where the tokens go, and what access
 * it gets. Everything in `details` comes from the client and is escaped.
 */
export function consentPage(details: ConsentDescription, handle: string, headers: Headers): Response {
  const name = escapeHtml(details.clientName);
  const domain = details.clientDomain ? escapeHtml(details.clientDomain) : undefined;
  const redirectHost = escapeHtml(details.redirectHost);

  const body = `<section class="card">
<h1>${name} vil koble seg til Fiken</h1>
<p>Når du fortsetter, logger du inn hos Fiken. ${name} får tilgang til foretakene du har gitt denne koblingen tilgang til.</p>
<dl>
  <div><dt>App</dt><dd>${name}</dd></div>
  ${domain ? `<div><dt>Publisert av</dt><dd>${domain}</dd></div>` : ""}
  <div><dt>Tilgangen sendes til</dt><dd>${redirectHost}</dd></div>
  <div><dt>Adresse</dt><dd>${escapeHtml(details.redirectUri)}</dd></div>
</dl>
${
  details.redirectIsLoopback
    ? `<p class="warning">Tilgangen sendes til et program på denne datamaskinen. Fortsett bare hvis du nettopp startet tilkoblingen der selv.</p>`
    : ""
}
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <fieldset>
    <legend>Tilgang</legend>
    <label class="option">
      <input type="radio" name="access" value="read" checked>
      <span><strong>Kun lesing</strong><span>Se foretak, kontakter, fakturaer, salg, kjøp, bilag, kontoer og rapporter.</span></span>
    </label>
    <label class="option">
      <input type="radio" name="access" value="write">
      <span><strong>Lesing og skriving</strong><span>Også lage utkast, kontakter og produkter, bokføre, registrere betalinger og sende fakturaer. Assistenten skal be deg bekrefte før den bokfører, sletter eller sender.</span></span>
    </label>
  </fieldset>
  <div class="actions">
    <button type="submit" name="decision" value="deny">Avbryt</button>
    <button type="submit" name="decision" value="approve" class="primary">Fortsett til Fiken</button>
  </div>
</form>
</section>
<p class="detail">Du kan trekke tilbake tilgangen i Fiken under Rediger konto → Sikkerhet → Apper du har gitt tilgang til.</p>`;

  return htmlPage({
    title: "Koble til Fiken",
    body,
    headers,
    // The form answers with a redirect to Fiken (approve) or back to the client (deny).
    formAction: ["https://fiken.no", originOf(details.redirectUri)].filter((origin): origin is string => origin !== undefined),
  });
}

function originOf(uri: string): string | undefined {
  try {
    const { origin } = new URL(uri);
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}
