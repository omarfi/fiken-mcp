# Fiken MCP

Hostet MCP-server for Fiken (Cloudflare Workers, TypeScript). Full spesifikasjon: docs/HANDOFF.md.

## Regler
- Svar på norsk. Kode, identifikatorer og kommentarer på engelsk. Tekst brukere ser, på norsk.
- Flere gode løsninger: legg fram alternativene og spør før du skriver kode. Ett spørsmål om gangen.
- packages/core skal aldri importere Cloudflare-APIer (håndheves av ESLint).
- Beløp: øre mot Fiken, kroner i verktøyene. All omregning i core/money.ts.
- Alle kall mot Fiken går gjennom FikenUserQueue. Maks 1 samtidig, maks 4/s.
- Aldri automatisk retry av skrivekall ved timeout eller 5xx. Ved 429 er retry trygt.
- PUT er full erstatning: hent → flett → skriv.
- Annotations på alle verktøy. Lesing, reversibel skriving og bokføring aldri i samme verktøy.
- Ingen hemmeligheter i repoet. Bruk wrangler secret og .dev.vars.
- Fikens OpenAPI-spec ligger i spec/fiken-openapi.yaml (offisiell, uendret). Den er fasit for felt og stier. Typene i core/src/fiken/types.gen.ts genereres fra den; ikke rediger dem for hånd.
- Relative imports i core bruker `.ts`-endelse (kjører direkte i Node, ingen enums/namespaces).

## Kommandoer
- `pnpm build` · `pnpm lint` · `pnpm test` · `pnpm check` (alle tre)
- `pnpm dev` · `pnpm run deploy` (ikke `pnpm deploy`, det er en innebygd pnpm-kommando)
- `pnpm spec:update` henter ny spec og regenererer typer
