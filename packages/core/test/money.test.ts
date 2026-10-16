import { describe, expect, it } from "vitest";
import { kronerSchema, kronerToOre, oreToKroner } from "../src/money.ts";

describe("money", () => {
  it("converts kroner to øre without floating point drift", () => {
    expect(kronerToOre(1000)).toBe(100_000);
    expect(kronerToOre(100.12)).toBe(10_012);
    expect(kronerToOre(19.99)).toBe(1_999);
    expect(kronerToOre(0.1 + 0.2)).toBe(30);
    expect(kronerToOre(-250.5)).toBe(-25_050);
  });

  it("refuses more than two decimals instead of rounding them away", () => {
    expect(() => kronerToOre(10.005)).toThrow("to desimaler");
    expect(() => kronerToOre(Number.NaN)).toThrow();
    expect(() => kronerToOre(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("converts øre to kroner", () => {
    expect(oreToKroner(10_012)).toBe(100.12);
    expect(oreToKroner(0)).toBe(0);
    expect(() => oreToKroner(1.5)).toThrow();
  });

  it("validates tool input in kroner", () => {
    const schema = kronerSchema();
    expect(schema.safeParse(1234.5).success).toBe(true);
    expect(schema.safeParse(1234.567).success).toBe(false);
    expect(schema.safeParse("12").success).toBe(false);
  });
});
