import { stripAccents } from "./match-normalize";

export const PICKER_LIMIT = 30;
const MAX_TOKENS = 8;

/**
 * Mots de la recherche du sélecteur de produit. Les caractères `, ( ) " \ % *` sont retirés : ils
 * casseraient la syntaxe d'un filtre `or` PostgREST (une virgule dans une désignation de facture
 * suffisait à faire échouer toute la requête).
 */
export function searchTokens(raw: string): string[] {
  return raw
    .replace(/[,()"\\%*]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
}

/**
 * Filtre `or` d'un mot : référence, libellé, fournisseur ou EAN du catalogue. `label_unaccent` pour que
 * « echalote » trouve « Échalote » (ILIKE ignore la casse, jamais les accents) ; référence et EAN sont
 * des codes. Un filtre `or` par mot, chaînés : tous les mots doivent être présents (une désignation de
 * facture complète retrouve alors le produit, au lieu de devoir être une sous-chaîne exacte).
 */
export function tokenFilter(token: string): string {
  const term = `%${token}%`;
  const unaccentTerm = `%${stripAccents(token)}%`;
  return `reference.ilike.${term},label_unaccent.ilike.${unaccentTerm},ean.ilike.${term},supplier_name.ilike.${term}`;
}
