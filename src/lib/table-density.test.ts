import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DENSITY,
  DENSITY_STORAGE_KEY,
  parseDensity,
  readDensity,
  writeDensity,
} from "./table-density";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("densité des tableaux", () => {
  test("une valeur inconnue retombe sur confortable", () => {
    expect(parseDensity("compact")).toBe("compact");
    expect(parseDensity("comfortable")).toBe("comfortable");
    expect(parseDensity("dense")).toBe(DEFAULT_DENSITY);
    expect(parseDensity(null)).toBe(DEFAULT_DENSITY);
    expect(parseDensity(undefined)).toBe(DEFAULT_DENSITY);
  });

  test("écrit puis relit le choix", () => {
    const storage = fakeStorage();
    expect(writeDensity(() => storage, "compact")).toBe(true);
    expect(storage.data.get(DENSITY_STORAGE_KEY)).toBe("compact");
    expect(readDensity(() => storage)).toBe("compact");
  });

  test("sans stockage, ou stockage qui lève : l'écran reste utilisable", () => {
    const throwing = () => {
      throw new Error("SecurityError");
    };
    expect(readDensity(throwing)).toBe(DEFAULT_DENSITY);
    expect(writeDensity(throwing, "compact")).toBe(false);
    expect(readDensity(() => undefined)).toBe(DEFAULT_DENSITY);
    expect(writeDensity(() => null, "compact")).toBe(false);
    const broken = {
      getItem: throwing,
      setItem: throwing,
    };
    expect(readDensity(() => broken)).toBe(DEFAULT_DENSITY);
    expect(writeDensity(() => broken, "compact")).toBe(false);
  });
});
