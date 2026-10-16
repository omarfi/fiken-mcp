import { describe, expect, it } from "vitest";
import { FikenApiError, readFikenMessage } from "../src/fiken/errors.ts";

// Bodies measured against the test company on 16.10.2026.
describe("readFikenMessage", () => {
  it("reads { error, error_description }", async () => {
    const body = { error_description: "Project/time-tracking module not activated", error: "402" };
    expect(await readFikenMessage(new Response(JSON.stringify(body)))).toBe("Project/time-tracking module not activated");
  });

  it("reads [{ logref, message }] and strips the Markdown", async () => {
    const body = [
      {
        logref: "6b3962fc-f6a9-4c4f-99c8-23ea99986e49",
        message:
          "**Transaksjon med åpen postering kan ikke annulleres** \n\n[Transaksjonen](/foretak/x/transaksjoner/1) inneholder åpen postering.",
      },
    ];
    expect(await readFikenMessage(new Response(JSON.stringify(body)))).toBe(
      "Transaksjon med åpen postering kan ikke annulleres Transaksjonen inneholder åpen postering.",
    );
  });

  it("falls back to the raw text", async () => {
    expect(await readFikenMessage(new Response("Bad Gateway"))).toBe("Bad Gateway");
    expect(await readFikenMessage(new Response(""))).toBeUndefined();
  });
});

describe("FikenApiError", () => {
  it("explains a missing module", () => {
    expect(new FikenApiError(402, "Project/time-tracking module not activated").message).toContain("modul som ikke er aktivert");
  });
});
