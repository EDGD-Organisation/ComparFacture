import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { toast } from "sonner";

import { isNextShortcut, nextToReview, type ReviewLine } from "./review-navigation";

const HIGHLIGHT_MS = 2000;

/** Surbrillance temporaire d'une ligne (anneau + fond léger, tokens du thème). */
export const HIGHLIGHT_ROW_CLASS = "bg-primary/5 ring-2 ring-inset ring-primary/40";

export const NEXT_TO_REVIEW_TITLE =
  "Prochaine ligne à vérifier (raccourci : n). « À vérifier » = statut « À vérifier » ou « Non rapproché », dans tous les onglets.";

const lineIdOf = (target: EventTarget | null) =>
  (target as Element | null)?.closest?.("[data-line-id]")?.getAttribute("data-line-id") ?? null;

/**
 * « Prochaine ligne à vérifier » : bouton et raccourci `n`. `lines` est la liste filtrée telle
 * qu'affichée ; `page`, `pageSize` et `onPageChange` ne servent qu'à la vue paginée. La ligne
 * courante est la dernière sur laquelle l'utilisateur a cliqué ou pris le focus (les lignes des
 * tableaux portent `data-line-id`), à brancher sur le conteneur avec `trackingProps`.
 */
export function useReviewNavigation<T extends ReviewLine>({
  lines,
  page,
  pageSize,
  onPageChange,
}: {
  lines: readonly T[];
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
}) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [request, setRequest] = useState<{ id: string } | null>(null);

  const goNext = useCallback(() => {
    const next = nextToReview(lines, currentId, {
      ...(page === undefined ? {} : { page }),
      ...(pageSize === undefined ? {} : { pageSize }),
    });
    if (!next) {
      toast.info("Plus aucune ligne à vérifier");
      return;
    }
    setCurrentId(next.id);
    if (page !== undefined && next.page !== page) onPageChange?.(next.page);
    setHighlightedId(next.id);
    setRequest({ id: next.id });
  }, [lines, currentId, page, pageSize, onPageChange]);

  useEffect(() => {
    if (!request) return;
    document
      .querySelector(`[data-line-id="${CSS.escape(request.id)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [request]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shortcut = {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
        target: event.target as HTMLElement | null,
      };
      if (!isNextShortcut(shortcut, document)) return;
      event.preventDefault();
      goNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext]);

  const track = (event: SyntheticEvent) => {
    const id = lineIdOf(event.target);
    if (id) setCurrentId(id);
  };

  return {
    goNext,
    highlightedId,
    trackingProps: { onClickCapture: track, onFocusCapture: track },
  };
}
