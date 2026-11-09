import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DENSITY_LABEL, parseDensity, type Density } from "@/lib/table-density";
import { useTableDensity } from "@/lib/use-table-density";

/** Largeur de la colonne de cases à cocher : doit rester égale à celle de `styles.css`. */
const SELECT_COLUMN_WIDTH = "2.75rem";

export function DensityToggle({
  value,
  onChange,
}: {
  value: Density;
  onChange: (value: Density) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(next) => next && onChange(parseDensity(next))}
      aria-label="Densité du tableau"
      className="gap-0 [&>button]:rounded-none [&>button:first-child]:rounded-l-md [&>button:last-child]:rounded-r-md [&>button]:px-3 [&>button]:text-xs [&>button+button]:-ml-px"
    >
      {(Object.keys(DENSITY_LABEL) as Density[]).map((density) => (
        <ToggleGroupItem
          key={density}
          value={density}
          aria-label={`Affichage ${DENSITY_LABEL[density].toLowerCase()}`}
        >
          {DENSITY_LABEL[density]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * Carte d'un tableau de données : titre, bascule de densité, barre d'outils optionnelle, puis le
 * `<table>` dans un conteneur qui défile DANS la carte (en-tête figé, voir `.data-table-scroll`
 * dans styles.css). `below` (état vide, erreur) et `footer` restent hors du défilement.
 */
export function DataTableCard({
  title,
  toolbar,
  below,
  footer,
  busy = false,
  busyLabel = "Chargement",
  selectable = false,
  children,
}: {
  title: string;
  toolbar?: ReactNode;
  below?: ReactNode;
  footer?: ReactNode;
  /** Chargement en cours : `aria-busy` et texte « Chargement » pour les lecteurs d'écran. */
  busy?: boolean;
  busyLabel?: string;
  /** Le tableau a une colonne de cases à cocher figée à gauche. */
  selectable?: boolean;
  children: ReactNode;
}) {
  const [density, setDensity] = useTableDensity();
  const style = selectable ? ({ "--select-w": SELECT_COLUMN_WIDTH } as CSSProperties) : undefined;
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="font-display text-lg">{title}</CardTitle>
        <DensityToggle value={density} onChange={setDensity} />
      </CardHeader>
      {toolbar}
      <CardContent className="p-0">
        <div className="data-table-scroll" data-density={density} aria-busy={busy} style={style}>
          {busy ? (
            <span role="status" className="sr-only">
              {busyLabel}
            </span>
          ) : null}
          {children}
        </div>
        {below}
        {footer}
      </CardContent>
    </Card>
  );
}

/**
 * Lignes squelettes d'un tableau en cours de chargement. Chaque cellule fait 2,25 rem de haut :
 * même hauteur qu'une vraie ligne (deux lignes de texte), donc pas de saut à l'arrivée des données.
 */
export function TableSkeletonRows({
  columns,
  rows = 8,
  selectable = false,
}: {
  columns: number;
  rows?: number;
  selectable?: boolean;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => (
            <td
              key={column}
              className="px-4 py-3"
              {...(selectable && column === 0 ? { "data-sticky": "select" } : {})}
            >
              {selectable && column === 0 ? null : (
                <div className="flex h-9 flex-col justify-center gap-1.5">
                  <Skeleton className="h-3.5 w-full max-w-40" />
                  <Skeleton className="h-3 w-2/3 max-w-24" />
                </div>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Cellule de prix en attente (prix Ozego en cours de chargement) : une barre, accessible. */
export function CellSkeleton({ align = "right" }: { align?: "left" | "right" }) {
  return (
    <>
      <Skeleton className={`h-4 w-16 ${align === "right" ? "ml-auto" : ""}`} aria-hidden="true" />
      <span className="sr-only">Chargement</span>
    </>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-6 text-sm text-destructive">
      <span>Impossible de charger les lignes : {message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}

/** Texte d'un état vide ou d'un « aucun résultat » sous un tableau. */
export function TableMessage({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}
