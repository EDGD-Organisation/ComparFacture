/** Le sous-ensemble d'une ligne dont dépend « à vérifier » (page facture comme vue projet). */
export type ReviewLine = {
  id: string;
  match_status: string | null;
  catalog_products: unknown;
};

/**
 * Une ligne est « à vérifier » quand son statut est `review` (produit rapproché mais pas validé) ou
 * `unmatched` (aucun produit) : tout sauf `confirmed`, comme `rowStatus` de la vue projet.
 */
export function needsReview(line: Pick<ReviewLine, "match_status" | "catalog_products">): boolean {
  return !line.catalog_products || line.match_status !== "confirmed";
}

export function countToReview(
  lines: ReadonlyArray<Pick<ReviewLine, "match_status" | "catalog_products">>,
) {
  return lines.reduce((total, line) => total + (needsReview(line) ? 1 : 0), 0);
}

export type NextToReview = { id: string; index: number; page: number };

/**
 * Prochaine ligne à vérifier APRÈS la ligne courante, dans l'ordre de `lines` (la liste filtrée
 * telle qu'affichée), en bouclant au début. Si la ligne courante est absente de la liste (jamais
 * cliquée, supprimée, masquée par un filtre), la recherche part du haut de la page `page`
 * (ramenée dans les bornes). Si la seule ligne à vérifier est la ligne courante, elle est renvoyée.
 * `page` du résultat : page (à partir de 1) qui contient la ligne, avec `pageSize` lignes par page
 * (par défaut une seule page).
 */
export function nextToReview<T extends ReviewLine>(
  lines: readonly T[],
  currentId: string | null,
  options: { page?: number; pageSize?: number } = {},
): NextToReview | null {
  const count = lines.length;
  if (count === 0) return null;
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? count) || 1);
  const currentIndex = currentId === null ? -1 : lines.findIndex((line) => line.id === currentId);

  let start: number;
  if (currentIndex >= 0) {
    start = currentIndex + 1;
  } else {
    const pageCount = Math.ceil(count / pageSize);
    const requested = Math.floor(options.page ?? 1);
    const page = Math.min(Math.max(Number.isFinite(requested) ? requested : 1, 1), pageCount);
    start = (page - 1) * pageSize;
  }

  for (let offset = 0; offset < count; offset += 1) {
    const index = (start + offset) % count;
    const line = lines[index]!;
    if (needsReview(line)) return { id: line.id, index, page: Math.floor(index / pageSize) + 1 };
  }
  return null;
}

type ShortcutTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
} | null;

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const TYPING_SELECTOR =
  '[contenteditable=""], [contenteditable="true"], [role="combobox"], [role="textbox"], [role="listbox"], [role="menu"], [role="dialog"], [role="alertdialog"]';

/** Vrai quand le focus est dans un champ de saisie, un select, un menu ou une boîte de dialogue. */
export function isTypingTarget(target: ShortcutTarget): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName && TYPING_TAGS.has(target.tagName.toUpperCase())) return true;
  return Boolean(target.closest?.(TYPING_SELECTOR));
}

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]';

/** Vrai quand une boîte de dialogue, un popover ou une liste déroulante est ouvert dans `root`. */
export function hasOpenOverlay(root: { querySelector: (selector: string) => unknown }): boolean {
  return Boolean(root.querySelector(OVERLAY_SELECTOR));
}

export type ShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  target: ShortcutTarget;
};

/** Le raccourci `n` ne se déclenche que seul, hors saisie, et quand rien n'est ouvert par-dessus la page. */
export function isNextShortcut(
  event: ShortcutEvent,
  root: { querySelector: (selector: string) => unknown },
): boolean {
  if (event.key.toLowerCase() !== "n") return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.defaultPrevented) {
    return false;
  }
  return !isTypingTarget(event.target) && !hasOpenOverlay(root);
}
