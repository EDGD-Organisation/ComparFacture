import { z } from "zod";

import { ALL, type MatchingFilters } from "./matching-view";

/**
 * Onglets et filtres dans l'adresse. Règles communes : une valeur par défaut n'apparaît jamais dans
 * l'URL, et un paramètre invalide ou inconnu retombe sur sa valeur par défaut (jamais d'erreur).
 */

export const VUES = ["synthese", "rapprochements"] as const;
export const ETAPES = ["rapprochements", "fournisseur", "ozego", "preferes"] as const;
export const STATUTS = ["all", "confirmed", "review", "unmatched"] as const;
export const VALIDATIONS = ["all", "validated", "unvalidated"] as const;
export const MODES = ["achat", "recap", "fournisseur", "ozego", "ozego-preferes"] as const;

/** Borne haute d'un numéro de page lu dans l'URL (au-delà, c'est une valeur absurde : page 1). */
export const MAX_PAGE = 100_000;

export type Vue = (typeof VUES)[number];
export type Etape = (typeof ETAPES)[number];
export type Mode = (typeof MODES)[number];

/** Texte libre : le routeur convertit `?q=12` en nombre, on le remet en texte. */
const text = z.union([z.string(), z.number().finite()]).transform(String).catch("");

/** Identifiant ou libellé d'un filtre : vide ou illisible = « tous » (`all`). */
const choice = z
  .union([z.string(), z.number().finite()])
  .transform((value) => String(value) || ALL)
  .catch(ALL);

const page = z.coerce.number().int().min(1).max(MAX_PAGE).catch(1);

const comparatifSchema = z.object({
  vue: z.enum(VUES).catch("synthese"),
  etape: z.enum(ETAPES).catch("rapprochements"),
  q: text,
  statut: z.enum(STATUTS).catch("all"),
  facture: choice,
  fournisseur: choice,
  validation: z.enum(VALIDATIONS).catch("all"),
  page,
});

const factureSchema = z.object({
  mode: z.enum(MODES).catch("recap"),
  q: text,
  statut: z.enum(VALIDATIONS).catch("all"),
});

/** État complet (toutes les clés, valeurs par défaut comprises) de la page du comparatif. */
export type ComparatifSearch = z.output<typeof comparatifSchema>;
/** Ce qui vit réellement dans l'URL : seulement les valeurs qui diffèrent du défaut. */
export type ComparatifSearchParams = Partial<ComparatifSearch>;

export type FactureSearch = z.output<typeof factureSchema>;
export type FactureSearchParams = Partial<FactureSearch>;

export const DEFAULT_COMPARATIF_SEARCH: ComparatifSearch = {
  vue: "synthese",
  etape: "rapprochements",
  q: "",
  statut: "all",
  facture: ALL,
  fournisseur: ALL,
  validation: "all",
  page: 1,
};

export const DEFAULT_FACTURE_SEARCH: FactureSearch = { mode: "recap", q: "", statut: "all" };

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

function omitDefaults<T extends Record<string, unknown>>(state: T, defaults: T): Partial<T> {
  const params: Partial<T> = {};
  for (const key of Object.keys(state) as Array<keyof T>) {
    if (state[key] !== defaults[key]) params[key] = state[key];
  }
  return params;
}

/** Lit des paramètres bruts (n'importe quoi) et rend l'état complet, défauts appliqués. */
export function parseComparatifSearch(raw: unknown): ComparatifSearch {
  return comparatifSchema.parse(asRecord(raw));
}

export function serializeComparatifSearch(state: ComparatifSearch): ComparatifSearchParams {
  return omitDefaults(state, DEFAULT_COMPARATIF_SEARCH);
}

/** `validateSearch` de la route /comparatifs/$id. */
export function validateComparatifSearch(raw: Record<string, unknown>): ComparatifSearchParams {
  return serializeComparatifSearch(parseComparatifSearch(raw));
}

export function parseFactureSearch(raw: unknown): FactureSearch {
  return factureSchema.parse(asRecord(raw));
}

export function serializeFactureSearch(state: FactureSearch): FactureSearchParams {
  return omitDefaults(state, DEFAULT_FACTURE_SEARCH);
}

/** `validateSearch` de la route /factures/$id. */
export function validateFactureSearch(raw: Record<string, unknown>): FactureSearchParams {
  return serializeFactureSearch(parseFactureSearch(raw));
}

/**
 * Applique une modification à l'URL courante et rend les paramètres à écrire (défauts omis).
 * `prev` est lu avec le même parseur : une URL abîmée ne casse pas la navigation.
 */
export function patchComparatifSearch(
  prev: unknown,
  patch: Partial<ComparatifSearch>,
): ComparatifSearchParams {
  return serializeComparatifSearch({ ...parseComparatifSearch(prev), ...patch });
}

export function patchFactureSearch(
  prev: unknown,
  patch: Partial<FactureSearch>,
): FactureSearchParams {
  return serializeFactureSearch({ ...parseFactureSearch(prev), ...patch });
}

/**
 * Changement de vue. Quitter « Tous les rapprochements » vide sous-onglet, filtres et page (comme
 * avant, quand ces états disparaissaient avec le composant) ; y entrer garde ce que l'URL contient.
 */
export function withVue(search: ComparatifSearch, vue: Vue): ComparatifSearch {
  return vue === "synthese" ? { ...DEFAULT_COMPARATIF_SEARCH, vue } : { ...search, vue };
}

export type MatchingTab = "general" | "fournisseur" | "ozego" | "ozego-preferes";

export function etapeToTab(etape: Etape): MatchingTab {
  if (etape === "rapprochements") return "general";
  return etape === "preferes" ? "ozego-preferes" : etape;
}

export function tabToEtape(tab: MatchingTab): Etape {
  if (tab === "general") return "rapprochements";
  return tab === "ozego-preferes" ? "preferes" : tab;
}

export function filtersFromSearch(search: ComparatifSearch): MatchingFilters {
  return {
    search: search.q,
    status: search.statut,
    invoiceId: search.facture,
    supplier: search.fournisseur,
    validation: search.validation,
  };
}

/** Modification de filtre : toujours de retour en page 1, comme la vue le faisait en état local. */
export function searchPatchFromFilters(patch: Partial<MatchingFilters>): Partial<ComparatifSearch> {
  const result: Partial<ComparatifSearch> = { page: 1 };
  if (patch.search !== undefined) result.q = patch.search;
  if (patch.status !== undefined) result.statut = patch.status;
  if (patch.invoiceId !== undefined) result.facture = patch.invoiceId;
  if (patch.supplier !== undefined) result.fournisseur = patch.supplier;
  if (patch.validation !== undefined) result.validation = patch.validation;
  return result;
}

export type KnownChoices = { invoiceIds: readonly string[]; suppliers: readonly string[] };

/**
 * Une fois les lignes chargées : une facture ou un fournisseur qui n'existe plus (lien périmé,
 * facture supprimée) redevient « tous », et la page est ramenée dans les bornes (`currentPage` =
 * page réellement affichée, déjà bornée par `paginate`). Rend le même objet si rien ne change.
 */
export function canonicalizeComparatifSearch(
  search: ComparatifSearch,
  known: KnownChoices,
  currentPage: number,
): ComparatifSearch {
  const facture =
    search.facture === ALL || known.invoiceIds.includes(search.facture) ? search.facture : ALL;
  const fournisseur =
    search.fournisseur === ALL || known.suppliers.includes(search.fournisseur)
      ? search.fournisseur
      : ALL;
  if (
    facture === search.facture &&
    fournisseur === search.fournisseur &&
    currentPage === search.page
  )
    return search;
  return { ...search, facture, fournisseur, page: currentPage };
}

/** Clé d'état de navigation posée par les liens facture de la vue « Tous les rapprochements ». */
export const FROM_VUE_STATE_KEY = "fromVue";

/** Paramètres du lien « retour au comparatif » : rouvre « Tous les rapprochements » si on en venait. */
export function backToComparatifSearch(historyState: unknown): ComparatifSearchParams {
  return asRecord(historyState)[FROM_VUE_STATE_KEY] === "rapprochements"
    ? { vue: "rapprochements" }
    : {};
}
