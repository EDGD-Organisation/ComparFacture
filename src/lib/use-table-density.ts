import { useCallback, useEffect, useState } from "react";

import { DEFAULT_DENSITY, readDensity, writeDensity, type Density } from "./table-density";

/**
 * Densité des tableaux, mémorisée dans le navigateur. Le premier rendu est toujours « confortable »
 * (même HTML côté serveur et côté client), le choix enregistré est lu juste après.
 */
export function useTableDensity() {
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);

  useEffect(() => {
    setDensityState(readDensity(() => window.localStorage));
  }, []);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    writeDensity(() => window.localStorage, next);
  }, []);

  return [density, setDensity] as const;
}
