/**
 * Structure du fichier « comparatif alimentaire » du client (modèle `src/assets/lbn-template.xlsx`).
 * Les noms de feuilles sont ceux du fichier d'origine : ses formules XLOOKUP y font référence.
 */
export const LBN_SHEETS = {
  main: "Comparatif alimentaire",
  /** Catalogue Ozego : une ligne par produit, colonnes A à X. */
  catalog: "2026,10 OZ al",
  /** Offre la moins chère par produit Ozego, colonnes A à H. */
  cheapest: "Prix le -cher",
} as const;

/** Première ligne du tableau « Achats clients » (l'en-tête est en ligne 31). */
export const LBN_FIRST_ROW = 32;
/** Cellules du tableau de récurrence fournisseur : lignes 17 à 27, colonnes T (nom), U (nombre), V (%). */
export const LBN_RECURRENCE_ROWS = { first: 17, last: 27, total: 28 } as const;
