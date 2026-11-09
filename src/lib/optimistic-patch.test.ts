import { describe, expect, test } from "bun:test";

import { applyPatch, revertPatch } from "./optimistic-patch";

type Prospect = {
  status: string;
  delivery_date: string | null;
  preferred_suppliers: string[];
  matching_suppliers: string[];
};

const base: Prospect = {
  status: "todo",
  delivery_date: null,
  preferred_suppliers: ["A"],
  matching_suppliers: [],
};

describe("applyPatch", () => {
  test("applique les champs du patch sans modifier l'original", () => {
    const next = applyPatch(base, { status: "done", delivery_date: "2026-12-01" });
    expect(next).toEqual({ ...base, status: "done", delivery_date: "2026-12-01" });
    expect(base.status).toBe("todo");
    expect(next).not.toBe(base);
  });

  test("une valeur null est une vraie modification, undefined n'en est pas une", () => {
    const withDate: Prospect = { ...base, delivery_date: "2026-12-01" };
    expect(applyPatch(withDate, { delivery_date: null })?.delivery_date).toBeNull();
    const untouched = { delivery_date: undefined } as unknown as Partial<Prospect>;
    expect(applyPatch(withDate, untouched)?.delivery_date).toBe("2026-12-01");
  });

  test("remplace une liste entière (fournisseurs)", () => {
    expect(applyPatch(base, { preferred_suppliers: ["B", "C"] })?.preferred_suppliers).toEqual([
      "B",
      "C",
    ]);
  });

  test("rien en cache : rien à patcher", () => {
    expect(applyPatch(undefined, { status: "done" })).toBeUndefined();
  });
});

describe("revertPatch", () => {
  test("remet les champs du patch à leur valeur d'avant", () => {
    const patch = { status: "done" };
    const optimistic = applyPatch(base, patch)!;
    expect(revertPatch(optimistic, base, patch)).toEqual(base);
  });

  test("garde une autre modification faite entre-temps sur un autre champ", () => {
    const first = { status: "done" };
    const second = { delivery_date: "2026-12-01" };
    const afterFirst = applyPatch(base, first)!;
    const afterBoth = applyPatch(afterFirst, second)!;
    expect(revertPatch(afterBoth, base, first)).toEqual({ ...base, delivery_date: "2026-12-01" });
  });

  test("cache vidé entre-temps : on ne fabrique rien", () => {
    expect(revertPatch(undefined, base, { status: "done" })).toBeUndefined();
  });
});
