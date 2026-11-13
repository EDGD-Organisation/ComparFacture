import { describe, expect, test } from "bun:test";

import { lineGap } from "./format";
import { comparableUnitPrice, normalizePackFactor } from "./pack";

describe("normalizePackFactor", () => {
  test("retombe sur 1 pour une valeur absente", () => {
    expect(normalizePackFactor(null)).toBe(1);
    expect(normalizePackFactor(undefined)).toBe(1);
  });

  test("retombe sur 1 pour une saisie vide ou non numérique", () => {
    expect(normalizePackFactor("")).toBe(1);
    expect(normalizePackFactor("   ")).toBe(1);
    expect(normalizePackFactor("abc")).toBe(1);
    expect(normalizePackFactor(Number.NaN)).toBe(1);
    expect(normalizePackFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  test("retombe sur 1 pour 0 et les valeurs négatives", () => {
    expect(normalizePackFactor(0)).toBe(1);
    expect(normalizePackFactor("0")).toBe(1);
    expect(normalizePackFactor(-6)).toBe(1);
    expect(normalizePackFactor("-2")).toBe(1);
  });

  test("conserve une valeur valide, y compris décimale et saisie avec virgule", () => {
    expect(normalizePackFactor(6)).toBe(6);
    expect(normalizePackFactor("12")).toBe(12);
    expect(normalizePackFactor("0,5")).toBe(0.5);
    expect(normalizePackFactor(" 2.5 ")).toBe(2.5);
  });
});

describe("calculs de prix avec un coefficient invalide", () => {
  test("comparableUnitPrice divise par 1 quand le coefficient est absent, nul ou négatif", () => {
    expect(comparableUnitPrice(10, null)).toBe(10);
    expect(comparableUnitPrice(10, 0)).toBe(10);
    expect(comparableUnitPrice(10, -3)).toBe(10);
    expect(comparableUnitPrice(10, Number.NaN)).toBe(10);
    expect(comparableUnitPrice(12, 6)).toBe(2);
    expect(comparableUnitPrice(null, 6)).toBeNull();
  });

  test("lineGap utilise 1 quand le coefficient est invalide et ne produit jamais NaN", () => {
    for (const invalid of [null, 0, -2, Number.NaN]) {
      const gap = lineGap(10, 8, 3, invalid);
      expect(gap?.packFactor).toBe(1);
      expect(gap?.comparablePrice).toBe(10);
      expect(gap?.totalGap).toBe(6);
    }
  });

  test("lineGap applique un coefficient valide", () => {
    const gap = lineGap(12, 1, 2, 6);
    expect(gap?.packFactor).toBe(6);
    expect(gap?.comparablePrice).toBe(2);
    expect(gap?.totalGap).toBe(12);
  });
});
