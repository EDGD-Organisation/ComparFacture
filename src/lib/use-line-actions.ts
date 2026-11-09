import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PickedProduct } from "@/components/ProductPicker";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast-error";

import {
  applyMatchAction,
  confirmLineAction,
  deleteLineAction,
  lineCacheKeys,
  savePackFactorAction,
  type ActionLine,
  type ActionResult,
  type LineContext,
  type Stage,
} from "./line-actions";

export function invalidateLineCaches(
  queryClient: QueryClient,
  context: Pick<LineContext, "invoiceId" | "prospectId">,
  { ozego }: { ozego: boolean },
) {
  for (const queryKey of lineCacheKeys(context, { ozego })) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Écritures de rapprochement d'une ligne de facture, partagées par la page facture et la vue
 * « Tous les rapprochements ». Chaque action invalide les caches concernés et signale toute erreur
 * Supabase par un toast : rien n'est avalé.
 */
export function useLineActions() {
  const queryClient = useQueryClient();

  function settle(
    result: ActionResult,
    context: LineContext,
    ozego: boolean,
    successMessage?: string,
  ) {
    if (result.changed) invalidateLineCaches(queryClient, context, { ozego });
    if (result.error) toastError(result.error);
    else if (successMessage) toast.success(successMessage);
  }

  return {
    async applyMatch(
      line: ActionLine,
      context: LineContext,
      product: PickedProduct | null,
      stage: Stage,
    ) {
      const result = await applyMatchAction(supabase, line, context, product, stage);
      settle(
        result,
        context,
        true,
        product ? "Correspondance enregistrée" : "Correspondance retirée",
      );
    },
    async confirm(line: ActionLine, context: LineContext) {
      settle(await confirmLineAction(supabase, line), context, false);
    },
    async deleteLine(line: ActionLine, context: LineContext) {
      settle(await deleteLineAction(supabase, line), context, true, "Ligne supprimée");
    },
    async savePackFactor(line: ActionLine, context: LineContext, value: number) {
      settle(await savePackFactorAction(supabase, line, context, value), context, false);
    },
  };
}
