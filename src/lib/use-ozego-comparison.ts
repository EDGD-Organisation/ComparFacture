import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { friendlyError } from "./errors";

import {
  bestByOzegoFromVariants,
  fetchOzegoVariants,
  ozegoIdsKey,
  type OzegoBest,
  type OzegoVariant,
} from "./ozego";

/** Les prix du catalogue ne changent qu'à la synchronisation : inutile de relire à chaque retour d'onglet. */
const OZEGO_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Variantes Ozego par identifiant, et meilleure offre de chaque groupe dérivée de ces variantes :
 * une seule lecture réseau pour les deux étapes Ozego, partagée par la page facture et le comparatif
 * (mêmes clés de cache, mêmes totaux). La clé de cache est l'ensemble trié des identifiants : le
 * même ensemble ne relance aucune requête. Une erreur de lecture est signalée, jamais remplacée
 * silencieusement par des prix absents.
 */
export function useOzegoComparison(ozegoIds: string[], enabled = true) {
  const idsKey = ozegoIdsKey(ozegoIds);
  const active = enabled && idsKey !== "";

  const variantsQuery = useQuery({
    queryKey: ["ozego-variants", idsKey],
    enabled: active,
    staleTime: OZEGO_STALE_TIME_MS,
    queryFn: () => fetchOzegoVariants(ozegoIds),
  });

  const errorMessage = variantsQuery.error?.message;
  useEffect(() => {
    if (errorMessage)
      toast.error(friendlyError(errorMessage), { id: "ozego-comparison-error", duration: 6000 });
  }, [errorMessage]);

  const variantsByOzego = variantsQuery.data;
  const bestByOzego = useMemo(
    () =>
      variantsByOzego ? bestByOzegoFromVariants(variantsByOzego) : new Map<string, OzegoBest>(),
    [variantsByOzego],
  );

  return {
    bestByOzego,
    variantsByOzego: variantsByOzego ?? new Map<string, OzegoVariant[]>(),
    isLoading: variantsQuery.isFetching,
  };
}
