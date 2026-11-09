import {
  isLineLocked,
  snapshotForUndo,
  type ActionLine,
  type ActionResult,
  type LineContext,
  type LineSnapshot,
  type Stage,
} from "./line-actions";

/** Le sous-ensemble d'une ligne dont la validation en lot a besoin (page facture comme vue projet). */
export type BulkLine = LineSnapshot &
  ActionLine & {
    catalog_products: unknown;
  };

export const SCORE_THRESHOLDS = [0.7, 0.8, 0.9, 0.95] as const;
export const DEFAULT_SCORE_THRESHOLD = 0.9;

/** Au-delà de ce nombre de lignes, la validation en lot demande une confirmation. */
export const CONFIRM_ABOVE = 20;
export const BULK_BATCH_SIZE = 10;

export const needsBulkConfirmation = (count: number) => count > CONFIRM_ABOVE;

/**
 * Une ligne entre dans un lot si elle a un produit rapproché, n'est pas déjà confirmée et n'est
 * pas verrouillée par une validation à une étape précédente : exactement les lignes qui montrent
 * le bouton « Valider ».
 */
export function isBulkValidatable(
  line: Pick<BulkLine, "catalog_products" | "match_status" | "validated_stage">,
  stage: Stage,
): boolean {
  return (
    Boolean(line.catalog_products) &&
    line.match_status !== "confirmed" &&
    !isLineLocked(line, stage)
  );
}

export function validatableLines<L extends BulkLine>(lines: readonly L[], stage: Stage): L[] {
  return lines.filter((line) => isBulkValidatable(line, stage));
}

/** Lignes validables dont le score de rapprochement atteint le seuil (inclus). */
export function selectAtOrAboveScore<L extends BulkLine>(
  lines: readonly L[],
  threshold: number,
  stage: Stage,
): L[] {
  return validatableLines(lines, stage).filter(
    (line) => line.match_score !== null && line.match_score >= threshold - 1e-9,
  );
}

export function parseThreshold(raw: string): number {
  const value = Number(raw);
  return (SCORE_THRESHOLDS as readonly number[]).includes(value) ? value : DEFAULT_SCORE_THRESHOLD;
}

/** Découpe en lots de `size` éléments (le dernier peut être plus court). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size) || 1);
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += step) {
    batches.push(items.slice(start, start + step));
  }
  return batches;
}

/** Les lignes cochées qui sont encore validables, dans l'ordre de `lines` (jamais de ligne périmée). */
export function effectiveSelection<L extends BulkLine>(
  lines: readonly L[],
  selected: ReadonlySet<string>,
  stage: Stage,
): L[] {
  return lines.filter((line) => selected.has(line.id) && isBulkValidatable(line, stage));
}

export type HeaderCheckState = boolean | "indeterminate";

/** Case d'en-tête : cochée si toutes les lignes validables de la page le sont, indéterminée si une partie. */
export function headerCheckState(
  pageSelectableIds: readonly string[],
  selected: ReadonlySet<string>,
): HeaderCheckState {
  if (pageSelectableIds.length === 0) return false;
  const count = pageSelectableIds.filter((id) => selected.has(id)).length;
  if (count === 0) return false;
  return count === pageSelectableIds.length ? true : "indeterminate";
}

/** Coche ou décoche d'un coup les lignes de la page, sans toucher aux autres pages. */
export function togglePageSelection(
  selected: ReadonlySet<string>,
  pageSelectableIds: readonly string[],
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const id of pageSelectableIds) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

export type BulkFailure = { id: string; message: string };
export type BulkSummary = { validated: string[]; failed: BulkFailure[] };

export function mergeSummaries(...summaries: BulkSummary[]): BulkSummary {
  return {
    validated: summaries.flatMap((summary) => summary.validated),
    failed: summaries.flatMap((summary) => summary.failed),
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/** « N validées, K en erreur » ; « K en erreur » est omis quand tout a réussi. */
export function summaryMessage(summary: BulkSummary): string {
  const validated = plural(summary.validated.length, "ligne validée", "lignes validées");
  return summary.failed.length === 0
    ? validated
    : `${validated}, ${summary.failed.length} en erreur`;
}

export function failureDetails(failures: readonly BulkFailure[], labelOf: (id: string) => string) {
  return failures.map((failure) => `${labelOf(failure.id)} : ${failure.message}`);
}

export type BulkValidationRun = BulkSummary & {
  /** État de chaque ligne validée, pris AVANT l'écriture : de quoi tout annuler. */
  snapshots: Map<string, LineSnapshot>;
};

/**
 * Valide les lignes lot par lot : les lots s'enchaînent, les lignes d'un lot partent ensemble.
 * Une erreur est consignée et n'arrête pas la suite. Les lignes ignorées (déjà confirmées ou
 * verrouillées au moment de l'appel) ne partent jamais.
 */
export async function runBulkValidation<L extends BulkLine>(
  lines: readonly L[],
  options: {
    stage: Stage;
    batchSize?: number;
    confirm: (line: L) => Promise<ActionResult>;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<BulkValidationRun> {
  const targets = validatableLines(lines, options.stage);
  const snapshots = new Map<string, LineSnapshot>();
  const taken = new Map(targets.map((line) => [line.id, snapshotForUndo(line)]));
  const run: BulkValidationRun = { validated: [], failed: [], snapshots };
  let done = 0;
  options.onProgress?.(0, targets.length);

  for (const batch of chunk(targets, options.batchSize ?? BULK_BATCH_SIZE)) {
    const results = await Promise.all(
      batch.map(async (line): Promise<[L, ActionResult]> => {
        try {
          return [line, await options.confirm(line)];
        } catch (error) {
          return [
            line,
            {
              changed: false,
              error: error instanceof Error ? error.message : "Erreur inconnue",
            },
          ];
        }
      }),
    );
    for (const [line, result] of results) {
      if (result.error) {
        run.failed.push({ id: line.id, message: result.error });
      } else {
        run.validated.push(line.id);
        snapshots.set(line.id, taken.get(line.id)!);
      }
    }
    done += batch.length;
    options.onProgress?.(done, targets.length);
  }
  return run;
}

/** Annule un lot : réécrit l'état d'avant de chaque ligne validée (mêmes lots, mêmes erreurs consignées). */
export async function runBulkUndo(
  snapshots: ReadonlyMap<string, LineSnapshot>,
  restore: (id: string, snapshot: LineSnapshot) => Promise<ActionResult>,
  batchSize = BULK_BATCH_SIZE,
): Promise<BulkSummary> {
  const summary: BulkSummary = { validated: [], failed: [] };
  for (const batch of chunk([...snapshots.entries()], batchSize)) {
    const results = await Promise.all(
      batch.map(async ([id, snapshot]): Promise<[string, ActionResult]> => {
        try {
          return [id, await restore(id, snapshot)];
        } catch (error) {
          return [
            id,
            { changed: false, error: error instanceof Error ? error.message : "Erreur inconnue" },
          ];
        }
      }),
    );
    for (const [id, result] of results) {
      if (result.error) summary.failed.push({ id, message: result.error });
      else summary.validated.push(id);
    }
  }
  return summary;
}

/** Une entrée par facture touchée : l'invalidation des caches se fait une fois, à la fin du lot. */
export function distinctCacheContexts(
  contexts: readonly Pick<LineContext, "invoiceId" | "prospectId">[],
): Array<Pick<LineContext, "invoiceId" | "prospectId">> {
  const byInvoice = new Map<string, Pick<LineContext, "invoiceId" | "prospectId">>();
  for (const context of contexts) {
    if (!byInvoice.has(context.invoiceId)) byInvoice.set(context.invoiceId, context);
  }
  return [...byInvoice.values()];
}
