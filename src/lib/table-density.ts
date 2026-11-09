export type Density = "comfortable" | "compact";

export const DENSITY_STORAGE_KEY = "comparfacture.table-density";
export const DEFAULT_DENSITY: Density = "comfortable";

export const DENSITY_LABEL: Record<Density, string> = {
  comfortable: "Confortable",
  compact: "Compact",
};

export function parseDensity(raw: unknown): Density {
  return raw === "compact" || raw === "comfortable" ? raw : DEFAULT_DENSITY;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** `getStorage` est appelé dans le try : même l'accès à `localStorage` peut lever (navigation privée, cookies bloqués). */
export function readDensity(getStorage: () => StorageLike | null | undefined): Density {
  try {
    return parseDensity(getStorage()?.getItem(DENSITY_STORAGE_KEY));
  } catch {
    return DEFAULT_DENSITY;
  }
}

export function writeDensity(
  getStorage: () => StorageLike | null | undefined,
  density: Density,
): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(DENSITY_STORAGE_KEY, density);
    return true;
  } catch {
    return false;
  }
}
