/**
 * Lookups in the Brønnøysund Register Centre's open register of legal entities (Enhetsregisteret).
 * No authentication. https://data.brreg.no/enhetsregisteret/api/docs/index.html
 */

export interface Organization {
  organizationNumber: string;
  name: string;
  address?: { streetAddress?: string; postCode?: string; city?: string; country: string };
  organizationForm?: string;
  bankrupt: boolean;
  underLiquidation: boolean;
}

/** Resolves an organization number, or undefined when the register has no such entity. */
export type OrganizationLookup = (organizationNumber: string) => Promise<Organization | undefined>;

export class BrregUnavailableError extends Error {
  constructor() {
    super("Enhetsregisteret svarer ikke akkurat nå. Prøv igjen, eller oppgi navn og adresse selv.");
    this.name = "BrregUnavailableError";
  }
}

const BASE = "https://data.brreg.no/enhetsregisteret/api/enheter/";

export function brregLookup(fetchImpl: typeof fetch = fetch): OrganizationLookup {
  return async (organizationNumber) => {
    let response: Response;
    try {
      response = await fetchImpl(BASE + encodeURIComponent(organizationNumber), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new BrregUnavailableError();
    }
    // 404: never registered. 410: deleted.
    if (response.status === 404 || response.status === 410) return undefined;
    if (!response.ok) throw new BrregUnavailableError();
    const entity = (await response.json()) as BrregEntity;
    const address = entity.forretningsadresse ?? entity.postadresse;
    return {
      organizationNumber: entity.organisasjonsnummer,
      name: entity.navn,
      ...(address
        ? {
            address: {
              streetAddress: address.adresse?.filter(Boolean).join(", ") || undefined,
              postCode: address.postnummer,
              city: address.poststed,
              country: address.land ?? "Norge",
            },
          }
        : {}),
      organizationForm: entity.organisasjonsform?.kode,
      bankrupt: entity.konkurs === true,
      underLiquidation: entity.underAvvikling === true || entity.underTvangsavviklingEllerTvangsopplosning === true,
    };
  };
}

/** Organization numbers have nine digits and a MOD11 check digit. */
export function isValidOrganizationNumber(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(value[index]), 0);
  const check = 11 - (sum % 11);
  return (check === 11 ? 0 : check) === Number(value[8]) && check !== 10;
}

interface BrregAddress {
  adresse?: string[];
  postnummer?: string;
  poststed?: string;
  land?: string;
}

interface BrregEntity {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform?: { kode?: string };
  forretningsadresse?: BrregAddress;
  postadresse?: BrregAddress;
  konkurs?: boolean;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
}
