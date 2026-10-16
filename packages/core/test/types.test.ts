import { describe, expectTypeOf, it } from "vitest";
import type { FikenComponents, FikenOperations } from "../src/index.ts";

// Compile-time guards: these fail `tsc` if a spec update changes shapes the tools rely on.
describe("generated Fiken types", () => {
  it("represents amounts as integer øre (number)", () => {
    expectTypeOf<NonNullable<FikenComponents["schemas"]["invoiceResult"]["gross"]>>().toEqualTypeOf<number>();
  });

  it("exposes the company slug used in every company path", () => {
    expectTypeOf<FikenOperations["getCompanies"]["responses"][200]["content"]["application/json"]>().toEqualTypeOf<
      FikenComponents["schemas"]["company"][]
    >();
    expectTypeOf<NonNullable<FikenComponents["schemas"]["company"]["slug"]>>().toEqualTypeOf<string>();
  });
});
