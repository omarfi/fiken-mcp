# Fiken MCP – overlevering til Claude Code

Dato: 16.10.2026 · Eier: Adrian Wollum, Wollum AS · Repo: `wollum-as/fiken-mcp`

Dette dokumentet er selvforsynt. Planleggingen skjedde i claude.ai (Cowork), og der ligger også en verktøyliste i Claude Docs og et prosjektnotat som du ikke har tilgang til. Alt du trenger fra dem, står her. Legg dokumentet i repoet som `docs/HANDOFF.md`.

---

## 0. Slik jobber du med Adrian

- Svar på norsk. All kode, alle identifikatorer og alle kodekommentarer er på engelsk. All tekst som sluttbrukere ser (verktøytitler, beskrivelser, feilmeldinger, samtykkeside, opplastingsside, README) er på norsk.
- Kort og presist. Ingen fyllsetninger.
- Når det finnes flere gode måter å løse noe på: legg fram alternativene med fordeler og ulemper og spør før du skriver kode. Still ett spørsmål om gangen.
- Forklar nye konsepter kort. Adrian er erfaren med MCP, Claude, Cloudflare (middels), Python og Vercel. TypeScript er han kompetent i, men ikke ekspert.
- Beslutningene i seksjon 3 er låst. Ikke åpne dem på nytt uten en konkret teknisk grunn.
- Design: rent og profesjonelt (tenk Linear/Vercel). Ingen gradienter, emoji eller «SaaS-mal»-preg på sidene serveren viser.

## 1. Mål

En hostet MCP-server som kobler Claude og andre MCP-klienter til Fiken (norsk regnskapsprogram) via Fiken OAuth. Brukeren legger inn én URL i Claude, logger inn med Fiken og er i gang. Ingen API-nøkler.

- Ikke kommersielt. Open source under Apache-2.0.
- Langsiktig mål: at Fiken tar over, implementerer og drifter dette selv. Derfor skal verktøylaget (`packages/core`) være plattformuavhengig og lett å løfte inn i Fikens egen stack. Fiken vil trolig ikke bruke Cloudflare, og vil ikke trenge OAuth-proxyen, siden de har sin egen OAuth-server.
- Fungerer også som markedsføring for Wollum AS.

Målgruppen er folk som fører regnskapet selv i Fiken. Adrians daglige drift, i rekkefølge:

1. Bokføre kjøp
2. Laste opp kvitteringer og bilag
3. Registrere salg
4. Opprette kontakter. Mange gidder ikke, og bruker kontantkjøp i stedet. Det er en dårlig vane som MCP-en skal motvirke.
5. Manuelle bilag
6. Bankavstemming. MCP-en skal ikke avstemme, men hjelpe brukeren å forstå hva som er ført feil.
7. A- og MVA-melding. Samme som over: forståelse, ikke levering.

I tillegg skal MCP-en kunne hente ut all nødvendig data, og peke til dokumentasjon for alt den ikke kan eller skal gjøre selv.

## 2. Status

Gjort av Adrian:

- [x] DNS for wollums.no ligger hos Cloudflare.
- [x] OAuth-app er opprettet i Fiken med redirect URI `https://fiken.mcp.wollums.no/callback`. Adrian har client ID og secret. Be om dem når du trenger dem, og legg dem bare inn med `wrangler secret put`. Aldri i repoet.
- [x] Testforetak er opprettet i Fiken.
- [x] Repoet `wollum-as/fiken-mcp` er opprettet med Apache-2.0.

Bygget:

- [x] M0 Repo-oppsett (16.10.2026).
- [x] M1 Auth, samtykkeside, deploy og `list_companies` (16.10.2026). Verifisert ende til ende fra Claude mot testforetaket «Fiken-demo - Slott og fly AS».
- [x] M2 Fiken-klient, `FikenUserQueue`, øre ↔ kroner og feilhåndtering (16.10.2026). Deployet og verifisert med `list_companies`.
- [x] M3 Leseverktøy (16.10.2026): `find_contacts`, `find_products`, `find_invoices`, `find_sales`, `find_purchases`, `find_accounts`, `find_journal_entries`, `find_inbox`, `get_report` (`result`, `balance`, `receivables`, `payables`, `product_sales`). 13 integrasjonstester mot testforetaket er grønne. Verifisert fra claude.ai i produksjon, alle kall ok.
- [x] M4 Gateway (16.10.2026): `explore_api` og `read_api` over 51 `GET`-operasjoner generert fra spec-en. Alle 131 operasjoner som ikke er `GET` avvises i test. Verifisert fra claude.ai, inkludert norsk melding for modul som ikke er aktivert (402).

## 3. Låste beslutninger

| Område | Beslutning |
| --- | --- |
| Navn | Fiken MCP |
| Visningsnavn | «Fiken av Wollum AS». Brukes i `serverInfo`, samtykkeside, opplastingsside og instruksjoner. |
| Beskrivelse | «Hostet MCP-server for Fiken. Koble Claude og andre AI-assistenter som støtter MCP til regnskapet ditt med Fiken-innlogging. Ingen API-nøkler.» (forslag, ikke endelig bekreftet) |
| Plattform | Cloudflare Workers, TypeScript |
| Auth | `@cloudflare/workers-oauth-provider`. Serveren er OAuth-server mot MCP-klienten og OAuth-klient mot Fiken. Fiken-tokens lagres kryptert i KV. |
| Kø | Én Durable Object per Fiken-bruker serialiserer alle kall mot Fiken |
| Struktur | Monorepo: `packages/core` (plattformuavhengig) og `apps/cloudflare` |
| Lisens | Apache-2.0, copyright Wollum AS. Behold lisensmerknader fra Cloudflare-malen i filene som kommer derfra. (Malen er MIT uten lisenshoder. Kopieres kode derfra, skal MIT-merknaden inn i NOTICE.) |
| Pakke | Ingen npm-pakke. Tjenesten er hostet. |
| Domene | `fiken.mcp.wollums.no` (Workers Custom Domain). Mønster for senere MCP-er: `<navn>.mcp.wollums.no`, én Worker per MCP. |
| MCP-endepunkt | `https://fiken.mcp.wollums.no/mcp` |
| Tekster | Veiledning, vilkår og personvernerklæring ligger på wollums.no, ikke i serveren |
| Verktøy | 23 verktøy, godkjent 16.10.2026. Se seksjon 7. |
| Dokumentasjon for modellen | Server-`instructions` peker til hjelp.fiken.no, kontohjelp.fiken.no og Skatteetaten. Se seksjon 8. |

README skal si tydelig at prosjektet ikke er tilknyttet Fiken AS. Ikke bruk Fikens logo.

### Beslutninger tatt underveis

Godkjent av Adrian 16.10.2026.

| Område | Beslutning | Begrunnelse |
| --- | --- | --- |
| Klienter | Bare Claude og ChatGPT. Kravet om «andre MCP-klienter» i seksjon 1 gjelder ikke. | Adrians valg. |
| Klientregistrering | Bare CIMD, ingen DCR. Godtatte klient-ID-er starter med `https://claude.ai/oauth/` eller `https://chatgpt.com/oauth/`. Andre avvises før metadata hentes. | Begge klientene bruker CIMD. Minst angrepsflate. |
| MCP-lag | MCP-SDK v2 `createMcpHandler` direkte, ikke Cloudflare `agents`. Stateless, ny `McpServer` per request, både 2026-07-28 og 2025-klienter. Ligger i core. | `McpAgent` er deprecated. SDK-en er web-standard, så hele MCP-laget kan flyttes til Fiken. |
| Tilgangsnivå | OAuth-scopes `fiken:read` og `fiken:write`, valgt på samtykkesiden. «Kun lesing» er forhåndsvalgt. Erstatter «lagres i grant-props» i seksjon 5. | Standard mekanisme, og biblioteket binder samtykke til scopes. |
| Samtykke | Vises ved hver innlogging, huskes ikke. | Enklest og sikrest. Innlogging skjer sjelden. |
| Token-levetid | Vårt access token: maks 1 time og minst 5 min kortere enn Fikens. Fiken-tokenet fornyes når det har under 2 timer igjen. Grant utløper etter 30 dager uten bruk. | Et verktøykall møter aldri et utløpt Fiken-token. |
| Kø-nøkkel | SHA-256 av normalisert e-post fra `GET /user`. | Fiken gir ingen bruker-ID. |
| Git | Commit og push direkte til `main` til M8 er ferdig. Deretter branch og PR. Ingen attribusjonslinjer. | Adrians valg. |
| Fiken-klient | `openapi-fetch` over de genererte typene, med `FikenTransport` som fetch. Mellomvare avviser manglende eller tomme sti-parametere (biblioteket lar dem ellers stå som `{navn}` i URL-en) og kaster `FikenApiError` ved feil. | Alle 189 operasjoner typet rett fra spec-en med lite egen kode. Adrians valg (M2). |
| Kø-regler | Ligger i core som `FikenScheduler` (serialisering, 300 ms mellom kall, backoff ved 429, circuit breaker etter tre 429 på rad, ingen retry av skrivekall). `FikenUserQueue` kjører den og lagrer circuit breaker-tilstanden. Svar krysser RPC som enkle data. | Testbart uten Cloudflare og gjenbrukbart for andre verter. |

## 4. Arkitektur

```
Claude / MCP-klient
   │  OAuth 2.1 (PKCE, klientregistrering) + MCP over Streamable HTTP
   ▼
fiken.mcp.wollums.no  (Cloudflare Worker)
   ├─ OAuthProvider (workers-oauth-provider)  ── KV: OAUTH_KV (klienter, grants, tokens)
   ├─ /authorize  → samtykkeside (egen) → videre til Fiken
   ├─ /callback   ← Fiken returnerer kode → tokenbytte → grant med props
   ├─ /mcp        → MCP-server, verktøy fra packages/core
   ├─ /upload/:token → opplastingsside for vedlegg
   └─ Durable Object: FikenUserQueue (én per Fiken-bruker)
          └─ alle kall mot api.fiken.no går herfra
   ▼
Fiken API v2  (https://api.fiken.no/api/v2)   +   Enhetsregisteret (data.brreg.no)
```

### Repostruktur (forslag)

```
fiken-mcp/
├─ apps/cloudflare/
│  ├─ wrangler.jsonc
│  └─ src/
│     ├─ index.ts           # OAuthProvider + ruting
│     ├─ auth/fiken.ts      # /authorize, /callback, tokenbytte og fornyelse
│     ├─ auth/consent.ts    # samtykkeside (HTML, norsk)
│     ├─ mcp.ts             # MCP-server, registrerer verktøy fra core
│     ├─ queue.ts           # FikenUserQueue (Durable Object)
│     └─ upload.ts          # opplastingslenker og -side
├─ packages/core/
│  └─ src/
│     ├─ fiken/client.ts    # typed klient, bruker en injisert transport
│     ├─ fiken/types.gen.ts # generert fra OpenAPI-spec
│     ├─ money.ts           # øre ↔ kroner
│     ├─ brreg.ts           # oppslag i Enhetsregisteret
│     ├─ tools/*.ts         # ett verktøy per fil
│     ├─ gateway/ops.gen.ts # allowlist av GET-operasjoner, generert fra spec
│     └─ instructions.ts    # server-instructions (seksjon 8)
├─ spec/fiken-openapi.json  # Fikens OpenAPI-spec
├─ docs/HANDOFF.md          # dette dokumentet
├─ CLAUDE.md
├─ README.md                # norsk
├─ LICENSE                  # Apache-2.0
└─ NOTICE
```

### Grensen mellom core og cloudflare

`packages/core` skal ikke importere noe fra Cloudflare. Den definerer grensesnitt som plattformen implementerer:

- `FikenTransport`: utfører et HTTP-kall mot Fiken for en gitt bruker. Cloudflare-implementasjonen sender kallet gjennom brukerens Durable Object.
- `UploadLinkIssuer`: lager en opplastingslenke for et gitt mål.
- `Clock` og `Logger` ved behov.

Målet er at Fiken kan ta `core`, skrive sine egne implementasjoner av grensesnittene og koble verktøyene til sin egen auth.

### Verifiser før du bygger

Disse var korrekte etter beste kunnskap 15.–16.10.2026, men sjekk dem mot dagens dokumentasjon:

- Siste MCP-spesifikasjon. Versjonen 2026-07-28 ser ut til å gjøre protokollen stateless uten sesjoner. Sjekk hva Cloudflare Agents SDK (`McpAgent` eller stateless handler) støtter nå.
- Cloudflares mal for remote MCP med tredjeparts-OAuth: `cloudflare/ai`, `demos/remote-mcp-github-oauth`. Bytt GitHub ut med Fiken.
- Fikens OAuth-endepunkter (authorize og token) og hvordan refresh tokens fungerer. Se https://api.fiken.no/api/v2/docs/.
- `workers-oauth-provider`: hvordan man fornyer upstream-tokens. Se etter `tokenExchangeCallback` eller tilsvarende i README.
- Claudes callback-URL for connectors, for allowlist av redirect URI.

#### Resultat av verifiseringen (16.10.2026)

- **MCP 2026-07-28 er stabil og stateless.** `initialize` og `Mcp-Session-Id` er fjernet. Ny påkrevd metode `server/discover` returnerer blant annet `instructions`. DCR er deprecated til fordel for CIMD. Kilde: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- **Agents SDK 0.28.1: `McpAgent` er deprecated og frosset (fra 0.20.0).** Anbefalt er `createMcpHandler` fra `agents/mcp/server`, med en fabrikk som lager en ny `McpServer` (`@modelcontextprotocol/server` 2.3.1) per request. Ingen Durable Object trengs for MCP. Med standardvalget `legacy: "stateless"` fungerer også 2025-klienter. Auth-props hentes med `getMcpAuthContext()?.props`. Krever `nodejs_compat`.
- **Konsekvens:** Durable Object brukes bare til `FikenUserQueue`. MCP-laget er stateless.
- **Malen `remote-mcp-github-oauth` er utdatert** (oauth-provider 0.8, `McpAgent`), MIT-lisensiert og uten lisenshoder i filene. Vi bruker den bare som referanse for struktur.
- **`workers-oauth-provider` 1.2.3** har innebygde hjelpere for samtykke og upstream-innlogging (`beginConsent`, `approveConsent`, `beginUpstream`, `finishUpstream` m.fl.) som dekker sjekklisten i seksjon 5: `__Host-`-cookies, state først etter samtykke, engangs, 10 min, `frame-ancestors 'none'`, og husket samtykke bundet til klient, redirect URI, ressurs og scopes. Erstatter malens `workers-oauth-utils.ts`, så vi trenger trolig ikke kopiere kode fra malen.
- **Fornyelse av Fiken-token:** `tokenExchangeCallback` kjører ved vårt kodebytte og vår fornyelse, ikke ved API-kall. Fiken-tokens ligger i props og fornyes der. Vårt access token må derfor leve kortere enn Fikens (ca. 24 t). Kast `OAuthError('invalid_grant')` hvis Fiken avviser refresh token.
- **Props** krypteres med AES-GCM og en nøkkel per grant, som bare kan pakkes ut med tokenet. Tokens lagres som SHA-256-hash.
- **CIMD** støttes med `clientIdMetadataDocumentEnabled: true` og compat-flagget `global_fetch_strictly_public`. **DCR** via `clientRegistrationEndpoint`, med `clientRegistrationCallback` for å godta eller avvise.
- **RFC 9728:** `resourceMetadata.resource` er påkrevd fra 1.0. Biblioteket sender `WWW-Authenticate` med `resource_metadata`, krever S256 PKCE og sender `iss`.
- Claudes callback-URL-er: se funn i seksjon 9.

## 5. Auth og sikkerhet

### Flyt

1. MCP-klienten registrerer seg (dynamisk klientregistrering eller Client ID Metadata Document, avhengig av hva biblioteket og spec-en støtter).
2. `GET /authorize` med klientens `client_id` og `redirect_uri`.
3. Har brukeren ikke godkjent denne klienten før, vises **vår egen samtykkeside** (se under).
4. Etter godkjenning: sett `state` (kryptografisk tilfeldig, engangs, maks 10 min, i kryptert cookie) og send brukeren til Fikens authorize-URL med vår faste client ID.
5. `GET /callback`: valider `state` mot cookien, bytt koden mot Fiken-tokens, hent Fiken-bruker (`GET /user`).
6. Fullfør grant i OAuthProvider med props: Fiken access token, refresh token, utløpstid, Fiken-bruker-ID, valgt tilgangsnivå.
7. MCP-klienten får **våre** tokens, aldri Fikens.

### Krav fra MCP-spesifikasjonens Security Best Practices (MUST)

Serveren er en «MCP proxy server» med fast client ID mot tredjepart, så confused deputy-reglene gjelder:

- Samtykke per `client_id`, sjekket **før** brukeren sendes til Fiken.
- Samtykkesiden viser klientens navn, hva den får tilgang til, og registrert `redirect_uri`.
- CSRF-beskyttelse, og `frame-ancestors 'none'` eller `X-Frame-Options: DENY`.
- Cookies: `__Host-`-prefiks, `Secure`, `HttpOnly`, `SameSite=Lax`, signert eller kryptert, bundet til `client_id`.
- `redirect_uri` valideres med eksakt strengmatch.
- `state` settes først etter godkjent samtykke, er engangs og har kort levetid.
- Ingen token passthrough. Godta bare tokens vi selv har utstedt.

### Tilgangsnivå

Samtykkesiden lar brukeren velge «Kun lesing» eller «Lesing og skriving». Valget lagres i grant-props (erstattet 16.10.2026: lagres som OAuth-scopes, se «Beslutninger tatt underveis» i seksjon 3). Skriveverktøyene registreres bare når brukeren har skrivetilgang. Avklar om Fiken OAuth har egne scopes (åpent spørsmål). Hvis ikke, håndheves nivået bare hos oss.

### Øvrig

- Alle path-parametere `encodeURIComponent`-es. Gateway-kall bygges bare fra allowlisten, aldri fra fri URL.
- Logg metadata (verktøy, foretak, status, varighet), aldri regnskapsdata eller tokens.
- Ingen hemmeligheter i repoet. Bruk `wrangler secret put` og `.dev.vars` (gitignored).

## 6. Fiken-klienten og køen

### Fakta om Fiken-APIet

- Base-URL: `https://api.fiken.no/api/v2`. Stier er relative til `/companies/{companySlug}` unntatt `/user` og `/companies`.
- Beløp er i **øre**. Verktøyene tar imot og viser **kroner**. All omregning skjer i `core/money.ts`.
- Datoer: `YYYY-MM-DD`.
- `PUT` er fullstendig erstatning. Felt du ikke sender med, kan forsvinne. Bruk alltid hent → flett → skriv.
- Opprettelse returnerer trolig ny ressurs i `Location`-headeren (verifiser). Les alltid tilbake etter skriving.
- Hvert foretak må ha Fikens API-tillegg (99 kr/mnd), også ved OAuth. Testforetak som ikke er registrert i Brønnøysund er unntatt.
- OAuth-appen er begrenset til 5 brukere til Fiken godkjenner den for produksjon.

### Rate limits (kritisk)

- Bare **én samtidig request** per bruker.
- Over 4 requests per sekund blir kallene bremset.
- Gjentatte 429-svar kan føre til at kontoen blir utestengt, og da må Fikens support oppheve det.

### FikenUserQueue (Durable Object)

- Én instans per Fiken-bruker-ID. Bruk SQLite-backed Durable Objects (`new_sqlite_classes` i migrasjonen), som er med på gratisplanen.
- Serialiser alle kall med en promise-kjede (mutex) i minnet. Merk at en Durable Object ikke blokkerer andre innkommende kall mens den venter på `fetch`, så du må ha en eksplisitt mutex.
- Token bucket: maks 4 kall per sekund, gjerne litt under.
- Ved 429: vent (`Retry-After` eller eksponentiell backoff) og prøv igjen. 429 betyr at kallet ikke ble utført, så det er trygt også for skriving.
- Ved timeout eller 5xx på **skrivekall**: aldri prøv igjen automatisk, siden utfallet er ukjent. Returner en tydelig feil og be modellen sjekke med et `find_*`-verktøy før et nytt forsøk.
- Etter flere 429 på rad: stopp nye kall i en periode (circuit breaker), for å unngå utestengelse.
- Forny Fiken-access token når det nærmer seg utløp.

### Feil

Oversett Fiken-feil til korte norske meldinger som modellen kan handle på, for eksempel «Fakturaen er allerede betalt» eller «Kontoen 3000 finnes ikke i kontoplanen».

## 7. Verktøy (godkjent)

23 verktøy: 12 for lesing og 11 for skriving. Parameterne under er skisser. Utled de faktiske feltene fra OpenAPI-spec-en.

### Prinsipper

- Ett verktøy per oppgave brukeren spør om, ikke ett per endepunkt.
- Slå sammen når spørsmålet er det samme (filtre i stedet for nye verktøy). Skill når risikoen er ulik. Lesing, reversibel skriving og bokføring ligger aldri i samme verktøy, fordi annotations og bekreftelse gjelder hele verktøyet.
- Navnemønster: `find_*` leser, `save_*` oppretter eller endrer, og alt som bokfører, sletter eller sender har egne verb.
- Alle verktøy tar `company` (Fiken-slug). Den kan utelates når brukeren bare har ett foretak.
- Lister gir sammendrag. Med `id` gir samme verktøy full detalj.
- `title` og `description` på norsk, navn på engelsk.
- Annotations på alle: `readOnlyHint: true` for lesing. Reversibel skriving: `readOnlyHint: false`, `destructiveHint: false`. Destruktiv: `destructiveHint: true`. Ekstern: `openWorldHint: true`.
- Etter skriving leses resultatet tilbake, så modellen vet at handlingen er utført.
- Gode vaner som standard: når motparten har org.nr., kobles kjøp og salg til en kontakt i stedet for kontantkjøp.

### Leseverktøy

| Verktøy | Svarer på | Skisse av parametere | Fiken-endepunkter |
| --- | --- | --- | --- |
| `list_companies` | Hvilke foretak brukeren har (navn, org.nr., slug) | – | `GET /companies` |
| `find_contacts` | Kunder og leverandører. Med `id`: også kontaktpersoner. | `query`, `org_number`, `email`, `role` (customer/supplier), `id`, `limit`, `page` | `/contacts`, `/contacts/{id}/contactPerson` |
| `find_products` | Produkter med pris og MVA-kode | `query`, `id`, `active` | `/products` |
| `find_invoices` | Fakturaer og kreditnotaer, med totalsum | `type` (invoice/credit_note), `status` (draft/unpaid/overdue/paid/all), `customer_id`, `from`, `to`, `id` | `/invoices`, `/invoices/drafts`, `/creditNotes`, `/creditNotes/drafts` |
| `find_sales` | Annet salg (kontant, Vipps o.l.), med utkast og betalinger | `status`, `from`, `to`, `id` | `/sales`, `/sales/drafts`, `/sales/{id}/payments` |
| `find_purchases` | Kjøp og kostnader | `status` (draft/unpaid/paid/all), `supplier_id`, `from`, `to`, `id` | `/purchases`, `/purchases/drafts`, `/purchases/{id}/payments` |
| `find_accounts` | Kontoplan, saldo på dato, bankkontoer og banksaldo | `query`, `number`, `type` (all/bank), `balance_date` | `/accounts`, `/accountBalances`, `/bankAccounts`, `/bankBalances` |
| `find_journal_entries` | Bilag og posteringer, også per konto. Med `id`: transaksjon og vedleggsliste. | `from`, `to`, `account`, `id` | `/journalEntries`, `/transactions/{id}` |
| `find_inbox` | Dokumenter i innboksen som venter på bokføring | `id` | `/inbox` |
| `get_report` | Ferdige oversikter | `type`: result, balance, vat, payroll, bank_check, product_sales, receivables, payables. `from`, `to`, `bank_account`. | `/accountBalances`, `/bankBalances`, `/journalEntries`, `/products/salesReport`, `/invoices`, `/purchases` |
| `explore_api` | Hvilke andre leseoperasjoner finnes for et område, med parametere | `area` (uten: liste over områder) | OpenAPI-spec, ingen kall til Fiken |
| `read_api` | Kjører én `GET`-operasjon fra allowlisten | `operation_id`, `params` | `GET`-endepunktene i allowlisten |

`get_report`:

- `vat`, `payroll` og `bank_check` er avledet og må verifiseres mot Fiken før de slippes.
- `vat`: utgående og inngående MVA per termin, fra MVA-kontoene (27xx).
- `payroll`: lønn, forskuddstrekk og arbeidsgiveravgift, fra kontoene (5000-, 2600- og 2770-serien).
- `bank_check`: sammenligner banksaldo med saldo i regnskapet, og viser posteringer på bankkontoen, mulige duplikater og åpne poster med samme beløp. Den avstemmer ikke.

Gatewayen (`explore_api` og `read_api`) dekker blant annet tilbud, ordrebekreftelser, gjentakende fakturaer, prosjekter, timeføring, vedlegg, grupper og bruker. Allowlisten genereres fra spec-en: bare `GET`. Svarene trimmes med samme grenser som de andre verktøyene.

### Skriveverktøy

| Verktøy | Hva det gjør | Klasse | Skisse av parametere | Fiken-endepunkter |
| --- | --- | --- | --- | --- |
| `save_contact` | Oppretter eller endrer kunde/leverandør, med kontaktpersoner. Fyller ut fra Enhetsregisteret på org.nr. og sjekker mot duplikat før opprettelse. | Reversibel | `id`, `org_number`, `name`, `email`, `phone`, `address`, `customer`, `supplier`, `contact_persons` | `/contacts`, `/contacts/{id}/contactPerson`, Enhetsregisteret |
| `save_product` | Oppretter eller endrer et produkt | Reversibel | `id`, `name`, `unit_price` (kr), `vat_type`, `income_account`, `active` | `/products` |
| `save_invoice_draft` | Oppretter eller endrer et utkast. Kan lages fra timer eller fra en ordrebekreftelse. | Reversibel | `id`, `type` (invoice/credit_note/offer), `customer_id`, `lines`, `issue_date`, `due_days`, `credited_invoice_id`, `from_time_entries`, `from_order_confirmation_id` | `/invoices/drafts`, `/creditNotes/drafts`, `/offers/drafts` |
| `save_purchase_draft` | Oppretter eller endrer et kjøpsutkast, eventuelt fra et dokument i innboksen. Kobles til leverandør når org.nr. er kjent. | Reversibel | `id`, `supplier_id` eller `supplier_org_number`, `kind` (supplier/cash), `date`, `due_date`, `lines` (beskrivelse, beløp, MVA-kode, konto), `inbox_document_id`, `payment_account` | `/purchases/drafts` |
| `save_sale_draft` | Oppretter eller endrer et utkast for annet salg (Vipps, kontant, nettbutikk) | Reversibel | `id`, `customer_id`, `date`, `lines`, `payment_account`, `paid` | `/sales/drafts` |
| `create_upload_link` | Gir en engangslenke der brukeren laster opp kvittering eller bilag. Serveren legger filen på målet. | Reversibel | `target_type`, `target_id` | `/…/drafts/{id}/attachments` |
| `delete_draft` | Sletter et utkast av hvilken som helst type | Destruktiv | `type`, `id` | `DELETE /…/drafts/{id}` |
| `finalize_draft` | Gjør et utkast endelig: faktura, kreditnota, tilbud, kjøp eller salg. Alt unntatt tilbud bokføres. | Destruktiv | `type`, `id` | `POST /…/drafts/{id}/create…` |
| `register_payment` | Registrerer betaling på faktura, salg eller kjøp. Stopper hvis posten allerede er betalt. Ment for betalinger som ikke kommer via bankavstemmingen. | Destruktiv | `target_type`, `target_id`, `date`, `amount` (kr), `account` | `/sales/{id}/payments`, `/purchases/{id}/payments` |
| `create_journal_entry` | Manuelt bilag. Kontrollerer at debet er lik kredit, at kontoene finnes og at MVA-kodene passer, før kallet sendes. | Destruktiv | `date`, `description`, `lines` (konto, debet eller kredit, MVA-kode, prosjekt) | `POST /generalJournalEntries` |
| `send_document` | Sender faktura, kreditnota eller tilbud | Destruktiv, ekstern | `type`, `id`, `method` (email/ehf) | `/invoices/send`, `/creditNotes/send`, `/offers/send` |

Flyter:

- **Kjøp:** brukeren legger kvitteringen i chatten (modellen leser bildet) eller i Fiken-innboksen → `save_purchase_draft` → `create_upload_link` hvis originalen ikke kom fra innboksen → `finalize_draft` etter bekreftelse.
- **Faktura:** `save_invoice_draft` → brukeren ser over → `finalize_draft` etter bekreftelse → `send_document` etter ny bekreftelse.

### Opplastingslenke

- `create_upload_link` lager et tilfeldig token (256 bit) i KV med Fiken-bruker, foretak, mål og utløp om 15 minutter. Den returnerer `https://fiken.mcp.wollums.no/upload/<token>`.
- `GET /upload/<token>`: enkel side på norsk med «Fiken av Wollum AS», filvelger og dra-og-slipp. Godtatte filtyper og maks størrelse avklares mot Fiken (åpent spørsmål).
- `POST /upload/<token>`: strømmer filen til Fikens vedleggsendepunkt via brukerens kø, sletter tokenet og viser bekreftelse.
- Engangsbruk, kort levetid, bundet til bruker og mål. Streng CSP. Ingen listing.
- Modellen bekrefter etterpå med `find_*` at vedlegget ligger der.

### Ikke i v1 (bevisst utelatt)

- Opprette faktura, kreditnota, salg eller kjøp direkte uten utkast
- Sletting av kontakter, produkter, kjøp, salg og transaksjoner
- Periodisering, oppgjør og avskriving av salg
- Gjentakende fakturaer (skriving), ordrebekreftelser (opprette og endre), prosjekter (skriving), føre timer
- Opprette bankkontoer og nummerserier (engangsoppsett i Fiken)

## 8. Server-instructions (utkast)

Sendes i `instructions` i initialize-svaret. Legg teksten i `packages/core/src/instructions.ts`. Den styrer modellen, men garanterer ingenting.

```text
Du er koblet til Fiken via «Fiken av Wollum AS».

- Bruk verktøyene for alt som gjelder data i brukerens Fiken. Har brukeren flere foretak, spør hvilket før første kall.
- Beløp er i kroner.
- Før du bruker finalize_draft, register_payment, create_journal_entry, send_document eller delete_draft: oppsummer nøyaktig hva som vil skje, og få en tydelig bekreftelse fra brukeren i samtalen.
- Når motparten har org.nr., koble kjøp og salg til en kontakt i stedet for å føre det som kontantkjøp. Opprett kontakten med save_contact om den mangler.
- Etter en skrivehandling: bekreft resultatet med et find_*-verktøy før du prøver på nytt.
- Du leverer ikke MVA-melding eller A-melding, og du avstemmer ikke bank. Forklar tallene og pek ut mulige feil.
- Spørsmål om hvordan Fiken fungerer: bruk Fikens hjelpesider som første kilde og lenk til artikkelen: https://hjelp.fiken.no
- Valg av konto: https://kontohjelp.fiken.no
- MVA-melding og A-melding: Skatteetaten, https://www.skatteetaten.no
- Du er ikke regnskapsfører. Ved tvil om regnskapsmessig behandling, anbefal brukeren å spørre en regnskapsfører.
```

## 9. Åpne spørsmål

Avklar mot testforetaket underveis, og oppdater dette dokumentet med svarene.

- [ ] **MVA:** Fiken-APIet ser ikke ut til å ha et endepunkt for MVA-melding. Stemmer `get_report` `vat`, beregnet fra MVA-kontoene, med Fikens egen MVA-melding?
  - Spec (16.10.2026): bekreftet, ingen MVA-endepunkt. Avstemming mot Fikens rapport gjenstår (M7).
- [x] **Lønn:** Finnes lønnsdata i APIet, eller bare via kontoene?
  - Svar (spec): bare via kontoene. Ingen lønnsendepunkt.
- [x] **Banklinjer:** Finnes uavstemte banktransaksjoner i APIet? Uten dem kan `bank_check` bare sammenligne saldoer og posteringer.
  - Svar (spec): nei. Bare `bankAccounts` og `bankBalances`. `bank_check` begrenses til saldoer og posteringer.
- [x] **Scopes:** Skiller Fiken OAuth mellom lese- og skrivetilgang?
  - Svar (spec): nei, `scopes: {}`. Tilgangsnivået håndheves bare hos oss.
- [ ] **PUT:** Erstatter `PUT` hele objektet? Gjelder kontakter, produkter og utkast.
- [x] **Location:** Returnerer `create…`-kallene ID-en til det nye dokumentet?
  - Svar (spec): ja, «For successful POSTs/PUTs/PATCHs a Location header is given in all cases». Body er tom, så vi leser tilbake via Location.
  - Målt 16.10.2026: `POST /generalJournalEntries` gir `201` med tom body, og `Location` peker på `/transactions/{id}`, ikke på bilaget som spec-en sier. Les tilbake via Location, ikke via antatt sti.
- [x] **Kreditnota-utkast:** Kan et kreditnota-utkast opprettes med referanse til en faktura?
  - Svar (spec): nei. Kreditnota-utkast er «uavhengig kreditnota». Kreditering av en faktura skjer direkte med `POST /creditNotes/full` (`invoiceId`) eller `/creditNotes/partial`, uten utkast. Påvirker `save_invoice_draft` (`credited_invoice_id`) og `finalize_draft`. Må avklares før M5.
- [ ] **Betaling på faktura:** Går den via tilhørende salg (`/sales/{id}/payments`), eller finnes et eget endepunkt?
  - Spec: ikke noe eget endepunkt. `invoiceResult.sale` er et `saleResult`, så betaling går trolig via `/sales/{saleId}/payments`. Verifiser i testforetaket.
- [ ] **Vedlegg:** Kan vedlegg lastes opp til utkast via API, og hvilke filtyper og størrelser godtas?
  - Spec: ja, `multipart/form-data` til `…/drafts/{id}/attachments`. Filnavn må slutte på .png, .jpeg, .jpg, .gif eller .pdf. I stedet for fil kan man sende `inboxDocumentId` eller `ehfDocumentId`, da trengs ingen opplasting. Maks størrelse står ikke i spec-en.
- [ ] **Låste perioder:** Avviser Fiken bilag og kjøp i en periode der MVA-meldingen er levert?
- [ ] **Sending i test:** `send_document` testes bare mot egen e-post fra testforetaket.
- [ ] **Gateway-listen:** Hvilke `GET`-operasjoner skal med i `read_api`, og hvordan trimmes svarene?
- [ ] **Tokenbruk:** Holder verktøydefinisjonene og typiske svar seg innenfor budsjettet (seksjon 11)?

Andre funn i spec-en (16.10.2026):

- `GET /user` returnerer bare `name` og `email`, ingen bruker-ID. Durable Object-nøkkelen må derfor avledes av e-post (f.eks. SHA-256 av normalisert e-post). Påvirker seksjon 5 og 6.
- `company` har `hasApiAccess` og `testCompany`. `list_companies` kan advare når API-tillegget mangler.
- Fiken støtter PKCE også for konfidensielle klienter og anbefaler det. Vi bruker det.
- Refresh token kan bli rotert («possibly updated refresh token»). Nytt refresh token må lagres før det gamle forkastes, og fornyelse må serialiseres per bruker.
- Access token varer i ca. 24 timer (`expires_in` ≈ 86 000 s).
- Spec-en finnes offisielt på https://api.fiken.no/api/v2/docs/swagger.yaml (YAML, nyere enn den uoffisielle kopien). Ligger i `spec/fiken-openapi.yaml`.
- `POST /products/salesReport` er en lese-operasjon som bruker POST. Den hører hjemme i `get_report`, ikke i gatewayen (som bare tillater GET).
- Sletting av kjøp, salg og transaksjoner er `PATCH …/delete`, ikke `DELETE`. Allowlisten må bygges på metode, ikke på sti.

Målt mot testforetaket 16.10.2026 (personlig API-nøkkel, se seksjon 12):

- **Saldo per dato:** `accountBalances?date=` gir utgående saldo på datoen, og bare for kontoer med bevegelse. Resultatkontoene (3000–8999) nullstilles ved årsskiftet, så saldoen er hittil i år. Balansekontoene føres videre. Resultat for en periode = saldo(til) − saldo(dagen før fra), innenfor samme år.
- **Navnesøk:** `contacts?name=` er delvis treff uten forskjell på store og små bokstaver. `products?name=` er bare eksakt treff, så produktsøk filtreres hos oss.
- **Paginering:** `/accounts` er paginert (493 kontoer), selv om tabellen i spec-en sier nei. Svar uten `Content-Length` (chunked).
- **Feilformat:** to varianter, `{ error, error_description }` og `[{ logref, message }]` der `message` er Markdown. Modul som ikke er aktivert gir `402` (f.eks. prosjekter).
- **Åpne posteringer:** et bilag med `open: true` kan ikke annulleres via API-et («Åpne posteringer kan kun endres/slettes av systemet»), stikk i strid med spec-en. `create_journal_entry` skal aldri sende `open: true`.
- **Annullering:** `PATCH /transactions/{id}/delete` krever `description` og lager en motpostering.
- **Bilagslinjer** har konto, men `journalEntries` kan ikke filtreres på konto. Filtreres hos oss.
- **`bankBalances`** er saldo fra bankavtalen, ikke fra regnskapet. Tom i testforetaket.
- **Svarstørrelse:** en faktura inneholder hele kunden, salget, linjene og PDF-lenker. Sammendragene må kuttes.
- **Personlig API-nøkkel** gir tilgang til alle brukerens foretak, ikke bare testforetaket. Integrasjonstestene låses til `fiken-demo-slott-og-fly-as` og sjekker `testCompany: true`.
- **Spor etter målingen:** to bilag datert 4.1.2027 i testforetaket (100 kr på 8040 og en motpostering), som går i null mot hverandre.
- **Rekkefølge:** `invoices`, `sales`, `creditNotes`, `journalEntries`, `transactions` og `offers` kommer eldste først og har ingen `sortBy`. `purchases` (`date desc`), `inbox` (`createdDate desc`) og `contacts` kan sorteres. Funnet i test fra claude.ai 16.10.2026.

Funn om Claude som MCP-klient (16.10.2026, kilder: claude.com/docs/connectors/building):

- **claude.ai web og Desktop sender ikke server-`instructions` til modellen** (åpen sak: https://github.com/anthropics/claude-ai-mcp/issues/93). Claude Code gjør det, avkortet til 4 096 tegn. Konsekvens: regler som må følges (bekreftelse før destruktive verktøy, kroner, kontakt i stedet for kontantkjøp) må også stå i verktøybeskrivelsene.
- Callback for claude.ai, Desktop og mobil: `https://claude.ai/api/mcp/auth_callback`. Claude Code: loopback `http://localhost:<port>/callback` og `http://127.0.0.1:<port>/callback`. MCP Inspector v2: `http://localhost:6274/oauth/callback`.
- Claude støtter både CIMD og DCR. CIMD brukes når metadata har `client_id_metadata_document_supported: true` og `none` i `token_endpoint_auth_methods_supported`. Claudes client_id: `https://claude.ai/oauth/mcp-oauth-client-metadata`, Claude Code: `https://claude.ai/oauth/claude-code-client-metadata`.
- Krav: S256 PKCE, RFC 8707 `resource`, 401 med `WWW-Authenticate: Bearer resource_metadata=…`, svar innen 10 s (30 s ved fornyelse). Grense ca. 150 000 tegn per verktøysvar og 240 s per kall.
- Katalogkrav: `title` og `readOnlyHint`/`destructiveHint` på alle verktøy, navn ≤ 64 tegn, lesing og skriving separat. Connectors som flytter penger godtas ikke. `register_payment` registrerer bare betaling i regnskapet, men formuleringen bør gjøre det tydelig.
- **Bufret verktøyliste:** etter en deploy med nye verktøy henter claude.ai på web listen på nytt i en ny samtale. En Claude Code-økt beholder den gamle listen, også etter `/mcp` → koble til på nytt (målt 16.10.2026). Test nye verktøy i en ny samtale.

## 10. Byggeplan

Én milepæl om gangen. Vis Adrian resultatet før du går videre.

| # | Milepæl | Ferdig når |
| --- | --- | --- |
| M0 | Repo-oppsett: pnpm workspaces, TypeScript strict, ESLint, Vitest, LICENSE, NOTICE, `CLAUDE.md`. Hent Fikens OpenAPI-spec til `spec/` og generer typer. | `pnpm build` og `pnpm test` er grønne |
| M1 | Auth: Cloudflare-malen tilpasset Fiken, samtykkeside, tilgangsnivå, deploy til `fiken.mcp.wollums.no`, `list_companies` | Adrian kan legge til connectoren i Claude, logge inn med Fiken og se foretakene sine |
| M2 | Fiken-klient, `FikenUserQueue`, øre ↔ kroner, feilhåndtering | Testene viser serialisering, 4 req/s, backoff ved 429 og ingen retry av skriving ved timeout |
| M3 | Leseverktøy (`find_*` og `get_report` uten de avledede typene) | Alle svarer korrekt mot testforetaket |
| M4 | Gateway (`explore_api`, `read_api`) med allowlist generert fra spec | Bare `GET` er mulig, path-parametere er enkodet |
| M5 | Reversible skriveverktøy, inkludert Enhetsregisteret og duplikatsjekk | Utkast og kontakter opprettes og leses tilbake i testforetaket |
| M6 | Destruktive verktøy og opplastingslenke | Hele kjøps- og fakturaflyten fungerer i Claude, med bekreftelser |
| M7 | Avledede rapporter (`vat`, `payroll`, `bank_check`) | Tallene er verifisert mot Fikens egne rapporter i testforetaket |
| M8 | Herding: tokenmåling, sikkerhetsgjennomgang, README (norsk) | Budsjettet holder, og sikkerhetskravene i seksjon 5 er sjekket punkt for punkt |

## 11. Budsjett

| Dimensjon | Mål |
| --- | --- |
| Kontekst | Under 25 verktøy. Alle definisjoner samlet under ca. 7 000 tokens. |
| Verktøyvalg | Ingen to verktøy svarer på samme spørsmål |
| Kall | Vanligvis 1–3 Fiken-kall per verktøykall |
| Svarlengde | Standard 20 rader, maks 100. Typisk svar under ca. 3 000 tokens. |
| Sikkerhet | Tre risikoklasser, aldri blandet i ett verktøy |
| Vedlikehold | Hvert verktøy har en test mot testforetaket. Typer og gateway genereres fra spec. CI varsler når spec-en endres. |

Tokentallene er anslag. Mål dem i MCP Inspector.

## 12. Testing

- **Enhetstester** i `core` med en mock av `FikenTransport` (Vitest).
- **Integrasjonstester** mot testforetaket. Bruk en personlig API-nøkkel for testforetaket som `FIKEN_TEST_TOKEN` i `.dev.vars` og som CI-secret. Merk testene slik at de ikke kjører uten nøkkelen.
- **Ende-til-ende** med MCP Inspector, og deretter i Claude som egen connector (`https://fiken.mcp.wollums.no/mcp`).
- `send_document` sendes bare til Adrians egen e-post.

## 13. Forslag til CLAUDE.md

Lag denne i M0 og hold den kort. Den lastes inn i hver økt.

```markdown
# Fiken MCP

Hostet MCP-server for Fiken (Cloudflare Workers, TypeScript). Full spesifikasjon: docs/HANDOFF.md.

## Regler
- Svar på norsk. Kode, identifikatorer og kommentarer på engelsk. Tekst brukere ser, på norsk.
- packages/core skal aldri importere Cloudflare-APIer.
- Beløp: øre mot Fiken, kroner i verktøyene. All omregning i core/money.ts.
- Alle kall mot Fiken går gjennom FikenUserQueue. Maks 1 samtidig, maks 4/s.
- Aldri automatisk retry av skrivekall ved timeout eller 5xx. Ved 429 er retry trygt.
- PUT er full erstatning: hent → flett → skriv.
- Annotations på alle verktøy. Lesing, reversibel skriving og bokføring aldri i samme verktøy.
- Ingen hemmeligheter i repoet. Bruk wrangler secret og .dev.vars.
- Fikens OpenAPI-spec ligger i spec/. Den er fasit for felt og stier.

## Kommandoer
- pnpm build · pnpm test · pnpm dev · pnpm deploy
```

## 14. Foreslåtte skills

Bruk disse hvis de finnes i økten:

- `mcp-builder`: beste praksis for MCP-servere og verktøydesign
- `engineering:testing-strategy`: testplan for M2–M6
- `senior-security` eller `engineering:code-review`: sikkerhetsgjennomgang i M8
- `engineering:deploy-checklist`: før første produksjonsdeploy

## 15. Kilder

- Fiken API v2: https://api.fiken.no/api/v2/docs/
- Fiken OpenAPI-spec (uoffisiell kopi, v2.0.0): https://github.com/bjerkio/fiken-js/blob/main/swagger.json
- Fiken-connector hos Chift (rate limits, API-tillegg, testforetak): https://docs.chift.eu/connectors/accounting/fiken.md
- MCP Security Best Practices: https://modelcontextprotocol.io/specification/latest/basic/security_best_practices
- Anthropic, Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Cloudflare, remote MCP-servere: https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/
- Cloudflare, Workers Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare, Durable Objects-priser og gratisplan: https://developers.cloudflare.com/durable-objects/platform/pricing
- Andre Fiken-MCP-er til inspirasjon:
  - https://github.com/jonasbarsten/fiken-mcp (gateway-mønster, beskyttelse mot dobbeltskriving)
  - https://github.com/gronnmann/fiken-mcp (full dekning, oversikt over APIet)
- Fikens hjelpesider: https://hjelp.fiken.no · Kontohjelp: https://kontohjelp.fiken.no
