/** A non-2xx response from Fiken, with a Norwegian message the model can act on. */
export class FikenApiError extends Error {
  readonly status: number;
  readonly fikenMessage: string | undefined;

  constructor(status: number, fikenMessage: string | undefined, options: { write?: boolean } = {}) {
    super(messageFor(status, fikenMessage, options.write ?? false));
    this.name = "FikenApiError";
    this.status = status;
    this.fikenMessage = fikenMessage;
  }
}

/**
 * Why a call never got a usable response from Fiken.
 *
 * - `outcome_unknown`: a write timed out or the connection failed. Fiken may have executed it.
 * - `rate_limited`: Fiken answered 429 too often; calls are paused to avoid a ban.
 * - `unavailable`: a read failed even after a retry.
 */
export type FikenFailureKind = "outcome_unknown" | "rate_limited" | "unavailable";

export class FikenTransportError extends Error {
  readonly kind: FikenFailureKind;
  readonly retryAfterSeconds: number | undefined;

  constructor(kind: FikenFailureKind, retryAfterSeconds?: number) {
    super(transportMessage(kind, retryAfterSeconds));
    this.name = "FikenTransportError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const CHECK_BEFORE_RETRY =
  "Den kan ha blitt utført i Fiken. Sjekk med et find_*-verktøy før du prøver igjen, ellers kan den bli registrert to ganger.";

function transportMessage(kind: FikenFailureKind, retryAfterSeconds: number | undefined): string {
  switch (kind) {
    case "outcome_unknown":
      return `Fiken svarte ikke på skrivehandlingen. ${CHECK_BEFORE_RETRY}`;
    case "rate_limited":
      return retryAfterSeconds
        ? `Fiken begrenser antall kall. Koblingen venter ${retryAfterSeconds} sekunder før neste kall. Prøv igjen etterpå.`
        : "Fiken begrenser antall kall. Vent litt og prøv igjen.";
    case "unavailable":
      return "Fiken svarer ikke akkurat nå. Prøv igjen om litt.";
  }
}

function messageFor(status: number, fikenMessage: string | undefined, write: boolean): string {
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
      if (status >= 500) {
        return write
          ? `Fiken svarte med en feil (${status}) på skrivehandlingen. ${CHECK_BEFORE_RETRY}`
          : `Fiken svarte med en feil (${status}). Prøv igjen senere.`;
      }
      return `Uventet svar fra Fiken (${status}).${detail}`;
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
