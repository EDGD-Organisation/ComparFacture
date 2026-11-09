import { stripAccents, tokenScore } from "./match-normalize";

// Mots qui ne distinguent pas un fournisseur d'un autre : formes juridiques, articles, et les
// deux mots que l'ERP et les factures ajoutent ou retirent librement ("Sysco France" / "SYSCO",
// "PassionFroid" / "POMONA PASSION FROID").
const GENERIC_WORDS = new Set([
  "sas",
  "sa",
  "sarl",
  "sasu",
  "eurl",
  "ets",
  "groupe",
  "group",
  "societe",
  "cie",
  "france",
  "pomona",
  "industrielle",
  "et",
  "de",
  "du",
  "la",
  "le",
  "les",
  "des",
]);

const MIN_PREFIX_LENGTH = 5;

export function supplierKey(name: string | null | undefined): string {
  return stripAccents((name ?? "").toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !GENERIC_WORDS.has(word))
    .join("");
}

/**
 * Le nom lu sur la facture par l'IA ("SYSCO FRANCE SAS", "EPISAVEURS CENTRE") n'est presque jamais
 * identique au nom ERP du catalogue ("SYSCO", "POMONA EPISAVEURS") : l'égalité stricte faisait
 * retomber presque toutes les lignes sur le rapprochement par libellé. On compare donc des clés
 * débarrassées des mots génériques, en tolérant qu'une clé (≥ 5 caractères) soit le préfixe de
 * l'autre. Le préfixe reste volontairement prudent : "SYSCO" et "FRANCE FRAIS" ne doivent jamais
 * être confondus, la même référence existant chez les deux pour des produits sans rapport.
 */
export function sameSupplier(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = supplierKey(a);
  const right = supplierKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= MIN_PREFIX_LENGTH && long.startsWith(short);
}

export type RefCandidate = { id: string; supplier_name: string | null; label: string };

/**
 * Choisit le produit du catalogue porteur de la référence de la ligne, parmi les produits qui ont
 * cette référence (tous fournisseurs confondus). Renvoie null quand la référence ne suffit pas :
 * mieux vaut laisser le flux libellé trancher qu'afficher « référence / validé » à tort.
 * - aucun candidat chez le même fournisseur : pas de repli sur un autre fournisseur (une même
 *   référence désigne des produits sans rapport d'un fournisseur à l'autre) ;
 * - plusieurs candidats : le libellé départage, seulement s'il y a un vainqueur net ;
 * - libellé sans aucun mot commun avec le produit : la référence est probablement mal lue.
 */
export function resolveByReference<T extends RefCandidate>(
  candidates: readonly T[],
  invoiceSupplier: string | null | undefined,
  lineLabel: string,
): T | null {
  const compatible = candidates.filter((c) => sameSupplier(c.supplier_name, invoiceSupplier));
  if (compatible.length === 0) return null;

  const ranked = compatible
    .map((candidate) => ({ candidate, score: tokenScore(lineLabel, candidate.label) }))
    .sort((x, y) => y.score - x.score);
  const [best, next] = ranked;
  if (!best || best.score <= 0) return null;
  if (next && next.score >= best.score) return null;
  return best.candidate;
}
