import { euro } from "./format";
import { countToReview, type ReviewLine } from "./review-navigation";

export type StepId = "importer" | "rapprocher" | "comparer";
export type StepStatus = "done" | "current" | "upcoming";

export type Step = {
  id: StepId;
  label: string;
  status: StepStatus;
  /** Sous-texte (compteurs) ; `null` quand il n'y a rien d'utile à dire. */
  detail: string | null;
  /** Une étape non activable est affichée mais n'est pas un bouton actif. */
  enabled: boolean;
};

export type StepperInput = {
  invoiceCount: number;
  lineCount: number;
  /** Lignes qui ont un produit rapproché. */
  matchedCount: number;
  /** Lignes « à vérifier » (statut à vérifier ou non rapproché). */
  toReviewCount: number;
  isExpert: boolean;
  /** Écart global déjà calculé sur la page (facturé moins catalogue) ; `null` s'il n'existe pas. */
  comparerGap?: number | null;
};

const plural = (count: number, one: string, many: string) => (count > 1 ? many : one);

/** Compteurs du parcours à partir des lignes déjà chargées sur la page. */
export function summarizeLines(
  lines: ReadonlyArray<Pick<ReviewLine, "match_status" | "catalog_products">>,
) {
  return {
    lineCount: lines.length,
    matchedCount: lines.filter((line) => Boolean(line.catalog_products)).length,
    toReviewCount: countToReview(lines),
  };
}

export function comparerHint(gap: number | null | undefined): string | null {
  if (gap === null || gap === undefined || !Number.isFinite(gap)) return null;
  return `${gap >= 0 ? "Économie potentielle" : "Surcoût potentiel"} ${euro(Math.abs(gap))}`;
}

/**
 * États des étapes « Importer, Rapprocher, Comparer ». L'étape courante est la première non
 * terminée ; « Comparer » n'est jamais terminée (c'est une vue) et devient courante quand tout est
 * rapproché. Un commercial ne voit pas les lignes : il n'a que « Importer ».
 */
export function stepperState(input: StepperInput): Step[] {
  const { invoiceCount, lineCount, matchedCount, toReviewCount, isExpert } = input;

  const importDone = invoiceCount > 0;
  const importStep: Step = {
    id: "importer",
    label: "Importer",
    status: importDone ? "done" : "current",
    detail: importDone
      ? `${invoiceCount} ${plural(invoiceCount, "facture", "factures")}`
      : "Aucune facture",
    enabled: true,
  };
  if (!isExpert) return [importStep];

  const matchDone = lineCount > 0 && matchedCount >= lineCount && toReviewCount === 0;
  const matchDetail =
    lineCount === 0
      ? "Aucune ligne extraite"
      : `${matchedCount}/${lineCount} ${plural(lineCount, "ligne rapprochée", "lignes rapprochées")}` +
        (toReviewCount > 0 ? ` · ${toReviewCount} à vérifier` : "");
  const matchStep: Step = {
    id: "rapprocher",
    label: "Rapprocher",
    status: matchDone ? "done" : importDone ? "current" : "upcoming",
    detail: matchDetail,
    enabled: invoiceCount > 0,
  };

  const compareStep: Step = {
    id: "comparer",
    label: "Comparer",
    status: importDone && matchDone ? "current" : "upcoming",
    detail: matchedCount > 0 ? comparerHint(input.comparerGap) : null,
    enabled: matchedCount > 0,
  };

  return [importStep, matchStep, compareStep];
}
