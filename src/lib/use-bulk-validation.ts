import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { RowSelection } from "@/components/BulkSelection";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { toastError } from "@/lib/toast-error";

import {
  DEFAULT_SCORE_THRESHOLD,
  distinctCacheContexts,
  effectiveSelection,
  headerCheckState,
  isBulkValidatable,
  needsBulkConfirmation,
  runBulkUndo,
  runBulkValidation,
  selectAtOrAboveScore,
  summaryMessage,
  togglePageSelection,
  validatableLines,
  type BulkLine,
  type BulkValidationRun,
} from "./bulk-validate";
import { confirmLineAction, restoreLineAction, type LineContext, type Stage } from "./line-actions";
import { invalidateLineCaches } from "./use-line-actions";

const UNDO_DURATION_MS = 6000;

type Report = {
  summary: string;
  failures: Array<{ id: string; message: string; label: string }>;
};

/**
 * Validation en lot d'une liste de lignes : cases à cocher, raccourcis de sélection, validation
 * par lots séquentiels, annulation d'un clic. `filteredLines` est la liste filtrée complète (toutes
 * pages), `pageLines` la page affichée. `resetKey` change avec l'onglet ou les filtres : la
 * sélection est alors vidée (jamais de ligne cochée que la liste ne montre plus).
 */
export function useBulkValidation<L extends BulkLine>({
  stage,
  filteredLines,
  pageLines,
  contextFor,
  lineLabel,
  resetKey,
}: {
  stage: Stage;
  filteredLines: readonly L[];
  pageLines: readonly L[];
  contextFor: (line: L) => LineContext;
  lineLabel: (line: L) => string;
  resetKey: string;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [threshold, setThreshold] = useState(DEFAULT_SCORE_THRESHOLD);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    setSelected(new Set());
  }, [resetKey]);

  const eligible = useMemo(() => validatableLines(filteredLines, stage), [filteredLines, stage]);
  const selectedLines = useMemo(
    () => effectiveSelection(filteredLines, selected, stage),
    [filteredLines, selected, stage],
  );
  const pageSelectableIds = useMemo(
    () => pageLines.filter((line) => isBulkValidatable(line, stage)).map((line) => line.id),
    [pageLines, stage],
  );
  const running = progress !== null;

  const selection: RowSelection<L> = {
    isSelectable: (line) => isBulkValidatable(line, stage),
    isSelected: (line) => selected.has(line.id),
    onToggle: (line, checked) =>
      setSelected((previous) => {
        const next = new Set(previous);
        if (checked) next.add(line.id);
        else next.delete(line.id);
        return next;
      }),
    headerState: headerCheckState(pageSelectableIds, selected),
    onHeaderChange: (checked) =>
      setSelected((previous) => togglePageSelection(previous, pageSelectableIds, checked)),
    headerDisabled: running || pageSelectableIds.length === 0,
  };

  function invalidate(lines: readonly L[]) {
    for (const context of distinctCacheContexts(lines.map(contextFor))) {
      invalidateLineCaches(queryClient, context, { ozego: false });
    }
  }

  async function undo(run: BulkValidationRun, lines: readonly L[]) {
    const summary = await runBulkUndo(run.snapshots, (id, snapshot) =>
      restoreLineAction(supabase, { id }, snapshot),
    );
    invalidate(lines);
    if (summary.failed.length > 0) {
      toastError(
        `${summary.failed.length} ligne(s) n'ont pas pu être remises dans leur état d'avant. Rechargez la page pour vérifier.`,
      );
    }
    if (summary.validated.length > 0) {
      toast.success(
        `${summary.validated.length} validation${summary.validated.length > 1 ? "s annulées" : " annulée"}`,
      );
    }
  }

  async function validate(lines: readonly L[]) {
    if (lines.length === 0 || running) return;
    setReport(null);
    setProgress({ done: 0, total: lines.length });
    let run: BulkValidationRun;
    try {
      run = await runBulkValidation(lines, {
        stage,
        confirm: (line) => confirmLineAction(supabase, line),
        onProgress: (done, total) => setProgress({ done, total }),
      });
    } catch (error) {
      setProgress(null);
      toastError(error);
      return;
    }
    setProgress(null);
    setSelected(new Set());
    const byId = new Map(lines.map((line) => [line.id, line]));
    const validatedLines = run.validated.flatMap((id) => byId.get(id) ?? []);
    // Une seule invalidation, une fois toutes les écritures faites.
    invalidate(validatedLines);

    const summary = summaryMessage(run);
    setReport({
      summary,
      failures: run.failed.map((failure) => ({
        ...failure,
        message: friendlyError(failure.message),
        label: byId.get(failure.id) ? lineLabel(byId.get(failure.id)!) : failure.id,
      })),
    });
    if (run.validated.length > 0) {
      toast.success(summary, {
        duration: UNDO_DURATION_MS,
        action: { label: "Annuler", onClick: () => void undo(run, validatedLines) },
      });
    }
    if (run.failed.length > 0) {
      toastError(
        `${run.failed.length} ligne(s) n'ont pas pu être validées. Le détail est sous le tableau.`,
      );
    }
  }

  return {
    selection,
    selectedCount: selectedLines.length,
    eligibleCount: eligible.length,
    threshold,
    setThreshold,
    progress,
    confirmOpen,
    setConfirmOpen,
    report,
    dismissReport: () => setReport(null),
    clear: () => setSelected(new Set()),
    selectAllFiltered: () => setSelected(new Set(eligible.map((line) => line.id))),
    selectAboveScore: () => {
      const ids = selectAtOrAboveScore(filteredLines, threshold, stage).map((line) => line.id);
      if (ids.length === 0) {
        toast.info(`Aucune ligne validable n'atteint ${Math.round(threshold * 100)} %`);
        return;
      }
      setSelected(new Set(ids));
    },
    requestValidate: () => {
      if (selectedLines.length === 0) return;
      if (needsBulkConfirmation(selectedLines.length)) setConfirmOpen(true);
      else void validate(selectedLines);
    },
    confirmValidate: () => void validate(selectedLines),
  };
}
