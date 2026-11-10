import type { RowStatus } from "@/lib/matching-view";

/** En-tête de la colonne « Fournisseur » (nom du fournisseur de la facture), première de tous les tableaux de lignes. */
export function SupplierHeader() {
  return <th className="px-4 py-3 font-medium">Fournisseur</th>;
}

/**
 * Cellule « Fournisseur » : nom du fournisseur de la facture, tronqué à l'écran (nom complet en
 * infobulle). `edge` : statut de la ligne quand c'est la première cellule du tableau (bord coloré).
 */
export function SupplierCell({
  name,
  edge,
}: {
  name: string | null | undefined;
  edge?: RowStatus | undefined;
}) {
  const label = name?.trim() || "—";
  return (
    <td data-edge={edge} className="px-4 py-3">
      <span className="block w-32 truncate font-medium" title={label}>
        {label}
      </span>
    </td>
  );
}
