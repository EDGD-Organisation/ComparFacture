import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Pastille de compteur d'un onglet. Largeur minimale fixe et `invisible` (jamais retirée) tant que
 * le nombre est inconnu, pour que l'onglet ne change pas de taille au chargement.
 */
export function TabCount({ value, title }: { value: number | null; title?: string | undefined }) {
  return (
    <span
      title={title}
      className={cn(
        badgeVariants({ variant: "secondary" }),
        "ml-2 min-w-6 justify-center px-1.5 tabular-nums",
        value === null && "invisible",
      )}
    >
      {value ?? 0}
    </span>
  );
}
