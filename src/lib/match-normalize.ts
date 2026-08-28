/**
 * Normalisation des libellés fournisseurs pour améliorer le rapprochement.
 */

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bfrom\b/g, "fromage"],
  [/\bfrge?\b/g, "fromage"],
  [/\bemment(al)?\b/g, "emmental"],
  [/\bmozza\b/g, "mozzarella"],
  [/\bcrm\b/g, "creme"],
  [/\bcr\b/g, "creme"],
  [/\bchoc\b/g, "chocolat"],
  [/\bpdt\b/g, "pomme de terre"],
  [/\bpdts?\b/g, "pomme de terre"],
  [/\bstl?e?\b/g, "sterilise"],
  [/\bsurg\b/g, "surgele"],
  [/\bcong\b/g, "congele"],
  [/\bpq\b/g, "paquet"],
  [/\bfil(et)?s?\b/g, "filet"],
  [/\bpoul\b/g, "poulet"],
  [/\bplt\b/g, "poulet"],
  [/\bdde\b/g, "dinde"],
  [/\bvf\b/g, "volaille francaise"],
  [/\bflts?\b/g, "filet"],
  [/\br\/sel\b/g, "sel reduit"],
  [/\bs\/p\b/g, "sans peau"],
  [/\bs\/a\b/g, "sans arete"],
  [/\bdes\b(?=\s)/g, "des"],
  [/\bjbon\b/g, "jambon"],
  [/\bvol(ail)?\b/g, "volaille"],
  [/\bnat(ure)?\b/g, "nature"],
  [/\bdemi[- ]sel\b/g, "demi sel"],
  [/\bug\b/g, "unite"],
];

// Mots qui n'apportent rien au rapprochement (conditionnement, logistique…)
const STOPWORDS = new Set([
  "de",
  "du",
  "des",
  "le",
  "la",
  "les",
  "au",
  "aux",
  "et",
  "en",
  "a",
  "pour",
  "sous",
  "vide",
  "carton",
  "colis",
  "caisse",
  "boite",
  "bte",
  "lot",
  "pack",
  "paquet",
  "sachet",
  "barquette",
  "plaque",
  "piece",
  "pieces",
  "pce",
  "pcs",
  "unite",
  "unites",
  "cs",
  "ct",
  "env",
  "environ",
  "ref",
  "cat",
  "categorie",
  "france",
  "frais",
  "produit",
]);

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeLabel(label: string | null | undefined): string {
  let text = stripAccents((label ?? "").toLowerCase());
  text = text.replace(/[^a-z0-9.,%]+/g, " ");
  text = text.replace(/(\d),(\d)/g, "$1.$2");
  for (const [pattern, replacement] of ABBREVIATIONS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Grammages / volumes présents dans le libellé, ramenés en grammes ou millilitres. */
export function extractSizes(label: string | null | undefined): number[] {
  const text = normalizeLabel(label);
  const sizes: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(kg|g|gr|l|cl|ml)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    const unit = match[2];
    if (unit === "kg" || unit === "l") sizes.push(value * 1000);
    else if (unit === "cl") sizes.push(value * 10);
    else sizes.push(value);
  }
  return sizes;
}

export function tokenize(label: string | null | undefined): string[] {
  return normalizeLabel(label)
    .split(" ")
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map((token) => (token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token));
}

/** Score de recouvrement lexical (0-1), pondéré vers la couverture du libellé facturé. */
export function tokenScore(a: string | null | undefined, b: string | null | undefined): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
      continue;
    }
    // correspondance partielle (préfixe commun d'au moins 4 lettres)
    for (const other of right) {
      if (
        token.length >= 4 &&
        other.length >= 4 &&
        (token.startsWith(other.slice(0, 4)) || other.startsWith(token.slice(0, 4)))
      ) {
        shared += 0.5;
        break;
      }
    }
  }
  const coverage = shared / left.size;
  const jaccard = shared / (left.size + right.size - shared);
  return Math.max(0, Math.min(1, 0.7 * coverage + 0.3 * jaccard));
}

/** Bonus/malus selon la concordance des grammages (500 g vs 500 g). */
export function sizeScore(a: string | null | undefined, b: string | null | undefined): number {
  const left = extractSizes(a);
  const right = extractSizes(b);
  if (left.length === 0 || right.length === 0) return 0;
  for (const l of left) {
    for (const r of right) {
      if (Math.abs(l - r) / Math.max(l, r) <= 0.05) return 1;
    }
  }
  return -1;
}

/** Plausibilité du prix : un tarif catalogue du même ordre de grandeur conforte le match. */
export function priceScore(
  invoicedUnitPrice: number | null | undefined,
  catalogPrice: number | null | undefined,
): number {
  if (!invoicedUnitPrice || !catalogPrice || invoicedUnitPrice <= 0 || catalogPrice <= 0) return 0;
  const ratio =
    invoicedUnitPrice > catalogPrice
      ? invoicedUnitPrice / catalogPrice
      : catalogPrice / invoicedUnitPrice;
  if (ratio <= 1.5) return 1;
  if (ratio <= 3) return 0.4;
  if (ratio <= 6) return 0;
  return -1;
}

/** Lignes de service (livraison, consigne…) : à ne pas rapprocher au catalogue. */
const NON_PRODUCT =
  /\b(forfait|livraison|transport|frais de port|consigne|palette|emballage|ecotaxe|eco[- ]?participation|remise|acompte|service|penalite)\b/;

export function isNonProductLine(label: string | null | undefined): boolean {
  const text = normalizeLabel(label);
  if (!text) return true;
  return NON_PRODUCT.test(text);
}
