import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { friendlyError } from "./errors";

import {
  fetchCheapestByOzego,
  fetchOzegoVariants,
  type OzegoBest,
  type OzegoVariant,
} from "./ozego";

/**
 * Meilleur prix et variantes par identifiant Ozego, partagés par la page facture et le comparatif
 * (mêmes clés de cache, mêmes totaux). Une erreur de lecture est signalée, jamais remplacée
 * silencieusement par des prix absents.
 */
export function useOzegoComparison(ozegoIds: string[], enabled = true) {
  const idsKey = [...new Set(ozegoIds)].sort().join(",");
  const active = enabled && ozegoIds.length > 0;

  const bestQuery = useQuery({
    queryKey: ["ozego-best", idsKey],
    enabled: active,
    queryFn: () => fetchCheapestByOzego(ozegoIds),
  });
  const variantsQuery = useQuery({
    queryKey: ["ozego-variants", idsKey],
    enabled: active,
    queryFn: () => fetchOzegoVariants(ozegoIds),
  });

  const errorMessage = (bestQuery.error ?? variantsQuery.error)?.message;
  useEffect(() => {
    if (errorMessage)
      toast.error(friendlyError(errorMessage), { id: "ozego-comparison-error", duration: 6000 });
  }, [errorMessage]);

  return {
    bestByOzego: bestQuery.data ?? new Map<string, OzegoBest>(),
    variantsByOzego: variantsQuery.data ?? new Map<string, OzegoVariant[]>(),
  };
}
