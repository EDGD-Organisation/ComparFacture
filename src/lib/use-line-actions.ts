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
  restoreLineAction,
  savePackFactorAction,
  snapshotForUndo,
  undeleteLineAction,
  type ActionLine,
  type ActionResult,
  type LineContext,
  type LineSnapshot,
  type Stage,
} from "./line-actions";

const UNDO_DURATION_MS = 6000;

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
 * Supabase par un toast : rien n'est avalé. Supprimer une ligne et retirer un rapprochement
 * proposent « Annuler » pendant 6 secondes.
 */
export function useLineActions() {
  const queryClient = useQueryClient();

  async function undoAction(
    undo: () => Promise<ActionResult>,
    context: LineContext,
    ozego: boolean,
  ) {
    const result = await undo();
    if (result.changed) invalidateLineCaches(queryClient, context, { ozego });
    if (result.error) toastError(result.error);
    else toast.success("Action annulée");
  }

  function settle(
    result: ActionResult,
    context: LineContext,
    ozego: boolean,
    successMessage?: string,
    undo?: () => Promise<ActionResult>,
  ) {
    if (result.changed) invalidateLineCaches(queryClient, context, { ozego });
    if (result.error) toastError(result.error);
    else if (successMessage) {
      toast.success(
        successMessage,
        undo
          ? {
              duration: UNDO_DURATION_MS,
              action: { label: "Annuler", onClick: () => void undoAction(undo, context, ozego) },
            }
          : undefined,
      );
    }
  }

  return {
    /**
     * Choisir ou changer le produit n'est pas annulable (l'apprentissage `product_mappings` a déjà
     * changé) : seul le retrait (`product` null) propose « Annuler ».
     */
    async applyMatch(
      line: ActionLine & LineSnapshot,
      context: LineContext,
      product: PickedProduct | null,
      stage: Stage,
    ) {
      const snapshot = product ? null : snapshotForUndo(line);
      const result = await applyMatchAction(supabase, line, context, product, stage);
      settle(
        result,
        context,
        true,
        product ? "Correspondance enregistrée" : "Correspondance retirée",
        snapshot ? () => restoreLineAction(supabase, line, snapshot) : undefined,
      );
    },
    async confirm(line: ActionLine, context: LineContext) {
      settle(await confirmLineAction(supabase, line), context, false);
    },
    async deleteLine(line: ActionLine, context: LineContext) {
      settle(await deleteLineAction(supabase, line), context, true, "Ligne supprimée", () =>
        undeleteLineAction(supabase, line),
      );
    },
    async savePackFactor(line: ActionLine, context: LineContext, value: number) {
      settle(await savePackFactorAction(supabase, line, context, value), context, false);
    },
  };
}
