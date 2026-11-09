import { describe, expect, test } from "bun:test";

import { createDebouncer } from "./debounce";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createDebouncer", () => {
  test("des appels rapprochés ne déclenchent qu'une fois, avec la dernière valeur", async () => {
    const seen: string[] = [];
    const debouncer = createDebouncer((value: string) => seen.push(value), 30);
    debouncer.call("l");
    debouncer.call("la");
    debouncer.call("lai");
    expect(seen).toEqual([]);
    expect(debouncer.pending()).toBe(true);
    await wait(80);
    expect(seen).toEqual(["lai"]);
    expect(debouncer.pending()).toBe(false);
  });

  test("des appels espacés déclenchent chacun", async () => {
    const seen: number[] = [];
    const debouncer = createDebouncer((value: number) => seen.push(value), 20);
    debouncer.call(1);
    await wait(60);
    debouncer.call(2);
    await wait(60);
    expect(seen).toEqual([1, 2]);
  });

  test("cancel annule l'appel en attente", async () => {
    const seen: string[] = [];
    const debouncer = createDebouncer((value: string) => seen.push(value), 20);
    debouncer.call("x");
    debouncer.cancel();
    expect(debouncer.pending()).toBe(false);
    await wait(60);
    expect(seen).toEqual([]);
  });
});
