/** A non-2xx response from Fiken, with a Norwegian message the model can act on. */
export class FikenApiError extends Error {
  readonly status: number;
  readonly fikenMessage: string | undefined;

  constructor(status: number, fikenMessage: string | undefined) {
    super(messageFor(status, fikenMessage));
    this.name = "FikenApiError";
    this.status = status;
    this.fikenMessage = fikenMessage;
  }
}

function messageFor(status: number, fikenMessage: string | undefined): string {
  const detail = fikenMessage ? ` Fiken sier: ${fikenMessage}` : "";
  switch (status) {
    case 400:
      return `Fiken avviste forespørselen.${detail}`;
    case 401:
      return "Innloggingen mot Fiken er ikke lenger gyldig. Brukeren må koble til Fiken på nytt.";
    case 403:
      return `Ingen tilgang i Fiken. Sjekk at koblingen har tilgang til foretaket, og at foretaket har API-tillegget.${detail}`;
    case 404:
      return "Fant ikke dette i Fiken. Sjekk foretak og ID.";
    case 409:
      return `Fiken meldte en konflikt.${detail}`;
    case 429:
      return "Fiken begrenser antall kall akkurat nå. Vent litt og prøv igjen.";
    default:
      return status >= 500
        ? `Fiken svarte med en feil (${status}). Prøv igjen senere.`
        : `Uventet svar fra Fiken (${status}).${detail}`;
  }
}

/** Extracts Fiken's own error text from a response body, if there is one. */
export async function readFikenMessage(response: Response): Promise<string | undefined> {
  const text = (await response.text()).trim();
  if (!text) return undefined;
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object") {
      for (const key of ["error_description", "message", "error"]) {
        const value = (body as Record<string, unknown>)[key];
        if (typeof value === "string" && value) return truncate(value);
      }
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return truncate(text);
}

function truncate(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
