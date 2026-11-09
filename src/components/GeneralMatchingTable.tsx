import type { ReactNode } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";

import {
  SelectAllCheckbox,
  SelectRowCheckbox,
  type RowSelection,
} from "@/components/BulkSelection";
import { DataTableCard, TableMessage, TableSkeletonRows } from "@/components/DataTable";
import { InvoiceCell } from "@/components/InvoiceCell";
import { PackFactorInput } from "@/components/PackFactorInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { euro, num } from "@/lib/format";
import { stageLabel } from "@/lib/line-actions";
import {
  isValidated,
  methodLabel,
  rowStatus,
  STATUS_LABEL,
  type MatchingLine,
  type RowStatus,
} from "@/lib/matching-view";
import { normalizePackFactor } from "@/lib/pack";
import { HIGHLIGHT_ROW_CLASS } from "@/lib/use-review-navigation";

const STATUS_CLASS: Record<RowStatus, string> = {
  confirmed: "bg-success/15 text-success",
  review: "bg-warning/20 text-warning-foreground",
  unmatched: "bg-destructive/10 text-destructive",
};

/** Tableau de l'onglet « Rapprochements » de la vue projet : une ligne par ligne de facture. */
export function GeneralMatchingTable({
  lines,
  allLinesCount,
  isLoading,
  error,
  isBusy,
  highlightedId,
  selection,
  toolbar,
  footer,
  onSavePackFactor,
  onPick,
  onConfirm,
  onUnmatch,
  onDelete,
}: {
  lines: MatchingLine[];
  allLinesCount: number;
  isLoading: boolean;
  /** Erreur de lecture : remplace le message « aucune ligne » (affichée sous le tableau). */
  error?: ReactNode;
  isBusy: (line: MatchingLine) => boolean;
  highlightedId: string | null;
  selection: RowSelection<MatchingLine>;
  toolbar?: ReactNode;
  footer?: ReactNode;
  onSavePackFactor: (line: MatchingLine, value: number) => void;
  onPick: (line: MatchingLine) => void;
  onConfirm: (line: MatchingLine) => void;
  onUnmatch: (line: MatchingLine) => void;
  onDelete: (line: MatchingLine) => void;
}) {
  return (
    <DataTableCard
      title="Tous les rapprochements"
      toolbar={toolbar}
      busy={isLoading}
      selectable
      footer={footer}
      below={
        error ??
        (!isLoading && lines.length === 0 ? (
          <TableMessage>
            {allLinesCount === 0
              ? "Aucune ligne extraite pour ce prospect."
              : "Aucune ligne ne correspond aux filtres."}
          </TableMessage>
        ) : null)
      }
    >
      <table className="w-full text-sm">
        <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th data-sticky="select" className="py-3">
              <SelectAllCheckbox
                state={selection.headerState}
                disabled={selection.headerDisabled}
                onChange={selection.onHeaderChange}
              />
            </th>
            <th className="px-4 py-3 font-medium">Facture</th>
            <th data-sticky="left" className="px-4 py-3 font-medium">
              Désignation fournisseur
            </th>
            <th className="px-4 py-3 text-right font-medium">Qté</th>
            <th className="px-4 py-3 text-right font-medium">PU facturé</th>
            <th className="px-4 py-3 text-right font-medium">Cond.</th>
            <th className="px-4 py-3 font-medium">Produit rapproché</th>
            <th className="px-4 py-3 font-medium">Rapprochement</th>
            <th data-sticky="right" className="px-4 py-3 text-right font-medium">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading ? <TableSkeletonRows columns={9} selectable /> : null}
          {lines.map((line) => {
            const product = line.catalog_products;
            const status = rowStatus(line);
            const working = isBusy(line);
            const highlighted = highlightedId === line.id;
            const validatedAt = stageLabel(line.validated_stage);
            const reference = line.supplier_reference || "sans référence";
            return (
              <tr
                key={line.id}
                data-line-id={line.id}
                data-highlighted={highlighted ? "true" : undefined}
                className={
                  [working ? "opacity-60" : "", highlighted ? HIGHLIGHT_ROW_CLASS : ""]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                <td data-sticky="select" data-edge={status} className="py-3">
                  {selection.isSelectable(line) ? (
                    <SelectRowCheckbox
                      label={line.label}
                      checked={selection.isSelected(line)}
                      disabled={selection.headerDisabled}
                      onChange={(checked) => selection.onToggle(line, checked)}
                    />
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <InvoiceCell line={line} />
                </td>
                <td data-sticky="left" className="min-w-56 px-4 py-3">
                  <div className="max-w-72">
                    <span className="line-clamp-2 break-words font-medium" title={line.label}>
                      {line.label}
                    </span>
                    <span
                      className="block truncate font-mono text-xs text-muted-foreground"
                      title={reference}
                    >
                      {reference}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {num(line.quantity)}
                  {line.unit ? (
                    <span className="ml-1 text-xs text-muted-foreground">{line.unit}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{euro(line.unit_price)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <PackFactorInput
                    value={normalizePackFactor(line.pack_factor)}
                    onSave={(value) => onSavePackFactor(line, value)}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-64">
                    {product ? (
                      <>
                        <span className="line-clamp-2 break-words" title={product.label}>
                          {product.label}
                        </span>
                        <span
                          className="block truncate font-mono text-xs text-muted-foreground"
                          title={product.reference}
                        >
                          {product.reference}
                        </span>
                        <span
                          className="block truncate text-xs text-muted-foreground"
                          title={product.supplier_name ?? ""}
                        >
                          {product.supplier_name ?? "—"}
                        </span>
                        <span
                          className="block truncate font-mono text-xs text-muted-foreground"
                          title={`Identifiant Ozego complet : ${product.ozego_id ?? "aucun"}`}
                        >
                          {product.ozego_id ?? "Sans identifiant Ozego"}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {line.supplier_reference
                          ? `Référence ${line.supplier_reference} introuvable`
                          : "Aucune référence fournisseur communiquée"}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={STATUS_CLASS[status]}>
                    {STATUS_LABEL[status]}
                  </Badge>
                  {product ? (
                    <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                      {methodLabel(line)}
                      {line.match_score !== null
                        ? ` · ${Math.round(line.match_score * 100)} %`
                        : ""}
                    </span>
                  ) : null}
                  {validatedAt ? (
                    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      Validée · {validatedAt}
                    </span>
                  ) : null}
                </td>
                <td data-sticky="right" className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {product && !isValidated(line) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={working}
                        title="Valider la correspondance"
                        onClick={() => onConfirm(line)}
                      >
                        <Check className="size-4 text-success" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={working}
                      title="Modifier la correspondance"
                      onClick={() => onPick(line)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    {product ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={working}
                        title="Retirer la correspondance"
                        onClick={() => onUnmatch(line)}
                      >
                        <X className="size-4 text-destructive" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={working}
                      title="Supprimer la ligne"
                      onClick={() => onDelete(line)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTableCard>
  );
}
