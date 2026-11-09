import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lignes squelettes d'une liste (comparatifs, factures, comptes). Chaque ligne fait la hauteur
 * d'une vraie ligne (deux lignes de texte, `py-4`) : pas de saut à l'arrivée des données.
 */
export function ListRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="divide-y divide-border">
      <span role="status" className="sr-only">
        Chargement
      </span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} aria-hidden="true" className="flex flex-wrap items-center gap-4 px-6 py-4">
          <div className="flex h-11 min-w-56 flex-1 flex-col justify-center gap-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3.5 w-72 max-w-full" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Squelette de la page des comparatifs : trois groupes par statut, deux lignes chacun. */
export function ProspectGroupsSkeleton({ groups = 3 }: { groups?: number }) {
  return (
    <div aria-busy="true" className="space-y-6">
      <span role="status" className="sr-only">
        Chargement
      </span>
      {Array.from({ length: groups }, (_, group) => (
        <Card key={group} aria-hidden="true">
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <ListRowsSkeleton rows={2} />
        </Card>
      ))}
    </div>
  );
}
