// Déclaration minimale de `bun:test` pour typer les *.test.ts sans installer @types/bun :
// ce paquet est aussi résolu par `unplugin` et casse le typage global de `fetch` dans l'application.
declare module "bun:test" {
  type Matchers = {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toThrow(expected?: unknown): void;
    not: Matchers;
  };
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): Matchers;
  export const mock: {
    module(specifier: string, factory: () => Record<string, unknown>): void;
  };
}
