import { describe, expect, it } from "vitest";
import { INSTRUCTIONS, SERVER_DISPLAY_NAME } from "../src/index.ts";

describe("INSTRUCTIONS", () => {
  it("names the server as users see it", () => {
    expect(INSTRUCTIONS).toContain(`«${SERVER_DISPLAY_NAME}»`);
  });

  it("points to the documentation sources", () => {
    for (const url of ["https://hjelp.fiken.no", "https://kontohjelp.fiken.no", "https://www.skatteetaten.no"]) {
      expect(INSTRUCTIONS).toContain(url);
    }
  });

  it("requires confirmation before every destructive tool", () => {
    for (const tool of ["finalize_draft", "register_payment", "create_journal_entry", "send_document", "delete_draft"]) {
      expect(INSTRUCTIONS).toContain(tool);
    }
  });
});
