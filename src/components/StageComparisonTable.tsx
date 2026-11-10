import { useEffect, useState, type ReactNode } from "react";
import { Check, Lock, Pencil, Trash2, X } from "lucide-react";

import {
  SelectAllCheckbox,
  SelectRowCheckbox,
  type RowSelection,
} from "@/components/BulkSelection";
import {
  CellSkeleton,
  DataTableCard,
  TableMessage,
  TableSkeletonRows,
} from "@/components/DataTable";
import { PackFactorInput } from "@/components/PackFactorInput";
import { SupplierCell, SupplierHeader } from "@/components/SupplierCell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { euro, percent, priceInput } from "@/lib/format";
import type { Stage } from "@/lib/line-actions";
import { matchMethodNote, rowStatus, STATUS_LABEL, type RowStatus } from "@/lib/matching-view";
import { HIGHLIGHT_ROW_CLASS } from "@/lib/use-review-navigation";
import { comparableUnitPrice, normalizePackFactor } from "@/lib/pack";
import {
  fournisseurLineView,
  ozegoLineView,
  type GapTotals,
  type OzegoOffer,
  type StageLine,
} from "@/lib/stage-rows";

export type LineFieldPatch = {
  quantity?: number;
  unit?: string | null;
  unit_price?: number | null;
};

type SharedTableProps<L extends StageLine> = {
  lines: L[];
  /** Unfiltered line count, to tell "no lines at all" apart from "the filters matched nothing". */
  allLinesCount: number;
  isLoading?: boolean | undefined;
  noLinesMessage?: string;
  tolerance: number;
  /** Absent: quantity, unit and unit price are shown read-only (project-wide view). */
  onSaveLineField?: (line: L, patch: LineFieldPatch) => void;
  onSavePackFactor: (line: L, value: number) => void;
  onPick: (line: L) => void;
  onUnmatch: (line: L) => void;
  onDelete: (line: L) => void;
  /** Present: adds a « Facture » column rendered by this function (project-wide view). */
  invoiceCell?: (line: L) => ReactNode;
  /** Present: adds the « Fournisseur » column (supplier of the invoice), first in the table. */
  supplierName?: (line: L) => string | null | undefined;
  isBusy?: (line: L) => boolean;
  /** Ligne mise en évidence ~2 s après « Prochaine ligne à vérifier ». */
  highlightedId?: string | null;
  showStats?: boolean;
  totalLabel?: string;
  footer?: ReactNode;
};

const LOCKED_TITLE = "Verrouillée : déjà validée à une étape précédente";

function rowClass(out: boolean, busy: boolean, highlighted: boolean) {
  return (
    [highlighted ? HIGHLIGHT_ROW_CLASS : out ? "bg-destructive/5" : "", busy ? "opacity-60" : ""]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

/** Attributs d'une ligne : repère pour « Prochaine ligne à vérifier » et états lus par styles.css. */
function rowAttributes(id: string, out: boolean, highlighted: boolean) {
  return {
    "data-line-id": id,
    "data-out": out ? "true" : undefined,
    "data-highlighted": highlighted ? "true" : undefined,
  } as const;
}

function EmptyState({
  isLoading,
  lines,
  allLinesCount,
  noLinesMessage,
}: {
  isLoading?: boolean | undefined;
  lines: unknown[];
  allLinesCount: number;
  noLinesMessage: string;
}) {
  if (isLoading || lines.length > 0) return null;
  return (
    <TableMessage>
      {allLinesCount === 0 ? noLinesMessage : "Aucune ligne ne correspond aux filtres."}
    </TableMessage>
  );
}

/** Première colonne de données, figée à gauche sur grand écran : désignation tronquée, référence dessous. */
function DesignationCell({
  line,
  status,
  edge,
  children,
}: {
  line: StageLine;
  status: RowStatus;
  /** Porte le bord de statut de la ligne (c'est la première cellule du tableau). */
  edge: boolean;
  children?: ReactNode;
}) {
  const reference = line.supplier_reference || "sans référence";
  return (
    <td data-sticky="left" data-edge={edge ? status : undefined} className="min-w-56 px-4 py-3">
      <div className="max-w-72">
        <span className="sr-only">Statut : {STATUS_LABEL[status]}. </span>
        <span className="line-clamp-2 break-words font-medium" title={line.label}>
          {line.label}
        </span>
        <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span className="truncate" title={reference}>
            {reference}
          </span>
          {children}
        </span>
      </div>
    </td>
  );
}

function SelectCell<L extends StageLine & { label: string }>({
  line,
  selection,
  status,
}: {
  line: L;
  selection: RowSelection<L>;
  status: RowStatus;
}) {
  return (
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
  );
}

export function EditableCell({
  value,
  title,
  className,
  format = (current) => (current === null ? "" : String(current)),
  onSave,
}: {
  value: number | null;
  title: string;
  className?: string;
  /** Texte affiché dans le champ (prix : 3 décimales). */
  format?: (value: number | null) => string;
  onSave: (value: number | null) => void;
}) {
  const shown = format(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const raw = draft.trim();
    // Champ non modifié : le texte affiché est arrondi, il ne doit jamais écraser la valeur exacte.
    if (raw === shown) return;
    if (raw === "") {
      if (value !== null) onSave(null);
      return;
    }
    const parsed = Number(raw.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(shown);
      return;
    }
    if (parsed !== value) onSave(parsed);
  };

  return (
    <Input
      value={draft}
      inputMode="decimal"
      title={title}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      className={`h-8 text-right tabular-nums ${className ?? ""}`}
    />
  );
}

export function EditableText({
  value,
  title,
  className,
  onSave,
}: {
  value: string;
  title: string;
  className?: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Input
      value={draft}
      title={title}
      placeholder="unité"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      className={`h-8 ${className ?? ""}`}
    />
  );
}

/** Mention courte sur une ligne ; la phrase complète reste en info-bulle et pour les lecteurs d'écran. */
function MatchNote({ method }: { method: string | null }) {
  const note = matchMethodNote(method);
  if (!note) return null;
  return (
    <span
      className={`block truncate text-xs ${note.tone === "warning" ? "text-warning-foreground" : "text-muted-foreground"}`}
      title={note.detail}
    >
      <span aria-hidden="true">{note.text}</span>
      <span className="sr-only">{note.detail}</span>
    </span>
  );
}

export function MatchBadge({ line }: { line: StageLine }) {
  if (line.match_status === "confirmed") {
    return (
      <Badge variant="secondary" className="shrink-0 whitespace-nowrap bg-success/15 text-success">
        Validé
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0 whitespace-nowrap">
      {line.match_method ?? "auto"}
      {line.match_score !== null ? ` ${Math.round(line.match_score * 100)} %` : ""}
    </Badge>
  );
}

function ReadOnlyQuantity({ line }: { line: StageLine }) {
  return (
    <span className="tabular-nums">
      {line.quantity}
      {line.unit ? <span className="ml-1 text-xs text-muted-foreground">{line.unit}</span> : null}
    </span>
  );
}

export function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "bad"
      ? "text-destructive"
      : tone === "warn"
        ? "text-warning-foreground"
        : "text-success";
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/** Tableau de l'étape « Comparatif référence fournisseur » (produit rapproché, prix catalogue, écart). */
export function FournisseurComparisonTable<L extends StageLine & { label: string }>({
  lines,
  allLinesCount,
  isLoading,
  noLinesMessage = "Aucune ligne extraite pour cette facture.",
  totals,
  invoicedTotal,
  catalogTotal,
  tolerance,
  onSaveLineField,
  onSavePackFactor,
  onPick,
  onConfirm,
  onUnmatch,
  onDelete,
  invoiceCell,
  supplierName,
  isBusy,
  highlightedId,
  showStats = true,
  totalLabel = "Total",
  footer,
  selection,
  toolbar,
}: SharedTableProps<L> & {
  totals: GapTotals;
  invoicedTotal: number;
  catalogTotal: number;
  onConfirm: (line: L) => void;
  /** Colonne de cases à cocher (validation en lot). */
  selection?: RowSelection<L>;
  /** Barre de raccourcis de sélection, sous le titre de la carte. */
  toolbar?: ReactNode;
}) {
  const lead = (invoiceCell ? 1 : 0) + (supplierName ? 1 : 0) + (selection ? 1 : 0);
  return (
    <>
      {showStats ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Écart total facturé"
            value={euro(totals.total)}
            tone={totals.total > 0 ? "bad" : "good"}
          />
          <StatCard
            label="Lignes hors tolérance"
            value={String(totals.anomalies)}
            tone={totals.anomalies ? "warn" : "good"}
          />
          <StatCard
            label="Lignes non rapprochées"
            value={String(totals.unmatched)}
            tone={totals.unmatched ? "warn" : "good"}
          />
        </div>
      ) : null}

      <DataTableCard
        title="Comparatif ligne par ligne"
        toolbar={toolbar}
        busy={Boolean(isLoading)}
        selectable={Boolean(selection)}
        footer={footer}
        below={
          <EmptyState
            isLoading={isLoading}
            lines={lines}
            allLinesCount={allLinesCount}
            noLinesMessage={noLinesMessage}
          />
        }
      >
        <table className="w-full text-sm">
          <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {selection ? (
                <th data-sticky="select" className="py-3">
                  <SelectAllCheckbox
                    state={selection.headerState}
                    disabled={selection.headerDisabled}
                    onChange={selection.onHeaderChange}
                  />
                </th>
              ) : null}
              {supplierName ? <SupplierHeader /> : null}
              {invoiceCell ? <th className="px-4 py-3 font-medium">Facture</th> : null}
              <th data-sticky="left" className="px-4 py-3 font-medium">
                Désignation fournisseur
              </th>
              <th className="px-4 py-3 font-medium">Produit catalogue</th>
              <th className="px-4 py-3 font-medium">Unité de négo + nom du fournisseur</th>
              <th className="px-4 py-3 text-right font-medium">Qté</th>
              <th className="px-4 py-3 text-right font-medium">PU facturé</th>
              <th className="px-4 py-3 text-right font-medium">Cond.</th>
              <th className="px-4 py-3 text-right font-medium">PU comparable</th>
              <th className="px-4 py-3 text-right font-medium">PU catalogue</th>
              <th className="px-4 py-3 text-right font-medium">Écart</th>
              <th data-sticky="right" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <TableSkeletonRows columns={10 + lead} selectable={Boolean(selection)} />
            ) : null}
            {lines.map((line) => {
              const { catalogPrice, gap, out, canConfirm } = fournisseurLineView(line, tolerance);
              const busy = isBusy?.(line) ?? false;
              const highlighted = highlightedId === line.id;
              const status = rowStatus(line);
              return (
                <tr
                  key={line.id}
                  {...rowAttributes(line.id, out, highlighted)}
                  className={rowClass(out, busy, highlighted)}
                >
                  {selection ? (
                    <SelectCell line={line} selection={selection} status={status} />
                  ) : null}
                  {supplierName ? (
                    <SupplierCell name={supplierName(line)} edge={selection ? undefined : status} />
                  ) : null}
                  {invoiceCell ? (
                    <td
                      data-edge={selection || supplierName ? undefined : status}
                      className="px-4 py-3"
                    >
                      {invoiceCell(line)}
                    </td>
                  ) : null}
                  <DesignationCell line={line} status={status} edge={lead === 0} />
                  <td className="min-w-60 px-4 py-3">
                    <div className="max-w-64">
                      {line.catalog_products ? (
                        <>
                          <span
                            className="line-clamp-2 break-words"
                            title={line.catalog_products.label}
                          >
                            {line.catalog_products.label}
                          </span>
                          <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                            <span className="truncate" title={line.catalog_products.reference}>
                              {line.catalog_products.reference}
                            </span>
                            <MatchBadge line={line} />
                          </span>
                          <MatchNote method={line.match_method} />
                        </>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <Badge
                            variant="secondary"
                            className="bg-warning/20 text-warning-foreground"
                          >
                            À rapprocher
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {line.supplier_reference ? (
                              <>
                                Référence{" "}
                                <span className="font-mono">{line.supplier_reference}</span>{" "}
                                introuvable dans notre base
                              </>
                            ) : (
                              "Aucune référence fournisseur communiquée"
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {line.catalog_products ? (
                      <div className="max-w-48">
                        <span className="block truncate" title={line.catalog_products.unit ?? ""}>
                          {line.catalog_products.unit || "—"}
                        </span>
                        <span
                          className="block truncate text-xs text-muted-foreground"
                          title={line.catalog_products.supplier_name ?? ""}
                        >
                          {line.catalog_products.supplier_name ?? "—"}
                        </span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {onSaveLineField ? (
                      <div className="flex items-center justify-end gap-1">
                        <EditableCell
                          value={line.quantity}
                          title="Quantité facturée"
                          className="w-20"
                          onSave={(value) => onSaveLineField(line, { quantity: Number(value) })}
                        />
                        <EditableText
                          value={line.unit ?? ""}
                          title="Unité facturée (kg, carton, L…)"
                          className="w-16"
                          onSave={(value) => onSaveLineField(line, { unit: value || null })}
                        />
                      </div>
                    ) : (
                      <ReadOnlyQuantity line={line} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {onSaveLineField ? (
                      <EditableCell
                        value={line.unit_price}
                        title="Prix unitaire facturé"
                        className="ml-auto w-28"
                        format={priceInput}
                        onSave={(value) => onSaveLineField(line, { unit_price: value })}
                      />
                    ) : (
                      <span className="tabular-nums">{euro(line.unit_price)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <PackFactorInput
                      value={normalizePackFactor(line.pack_factor)}
                      onSave={(value) => onSavePackFactor(line, value)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {euro(comparableUnitPrice(line.unit_price, line.pack_factor))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {euro(catalogPrice)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${
                      !gap
                        ? "text-muted-foreground"
                        : gap.unitGap > 0
                          ? "text-destructive"
                          : gap.unitGap < 0
                            ? "text-success"
                            : ""
                    }`}
                  >
                    {gap ? (
                      <>
                        <span className="block">{euro(gap.totalGap)}</span>
                        <span className="block text-xs">{percent(gap.percentGap)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-sticky="right" className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {canConfirm ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          title="Valider la correspondance"
                          onClick={() => onConfirm(line)}
                        >
                          <Check className="size-4 text-success" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        title="Modifier la correspondance"
                        onClick={() => onPick(line)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      {line.catalog_products ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          title="Retirer la correspondance"
                          onClick={() => onUnmatch(line)}
                        >
                          <X className="size-4 text-destructive" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
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
          <tfoot className="border-t-2 border-border bg-muted/60 font-medium">
            <tr>
              <td className="px-4 py-3" colSpan={4 + lead}>
                {totalLabel}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{euro(invoicedTotal)}</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {euro(catalogTotal)}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums ${totals.total > 0 ? "text-destructive" : totals.total < 0 ? "text-success" : ""}`}
              >
                {euro(totals.total)}
              </td>
              <td data-sticky="right" className="px-4 py-3" />
            </tr>
          </tfoot>
        </table>
      </DataTableCard>
    </>
  );
}

/**
 * Shared table for the 2 Ozego comparison views (tous fournisseurs moins cher /
 * fournisseurs préférés) — same columns and edit actions, only `rowFor`
 * (which reference price to compare against) and the surrounding labels differ.
 */
export function OzegoComparisonTable<L extends StageLine>({
  lines,
  allLinesCount,
  isLoading,
  ozegoLoading = false,
  noLinesMessage = "Aucune ligne extraite pour cette facture.",
  stage,
  cardTitle,
  referenceColumnLabel,
  unmatchedLabel,
  statLabel,
  rowFor,
  totals,
  invoicedTotal,
  tolerance,
  onSaveLineField,
  onSavePackFactor,
  onPick,
  onUnmatch,
  onDelete,
  invoiceCell,
  supplierName,
  isBusy,
  highlightedId,
  showStats = true,
  totalLabel = "Total",
  footer,
}: SharedTableProps<L> & {
  /** Which of the 3 pages this table is — used to lock editing for lines
   * already validated on an earlier page, see `isLineLocked`. */
  stage: Stage;
  cardTitle: string;
  referenceColumnLabel: string;
  unmatchedLabel: string;
  statLabel: string;
  rowFor: (line: L) => OzegoOffer | undefined;
  totals: GapTotals & { bestTotal: number };
  invoicedTotal: number;
  /** Prix Ozego en cours de chargement : cellules squelettes à la place des prix absents. */
  ozegoLoading?: boolean;
}) {
  const lead = (invoiceCell ? 1 : 0) + (supplierName ? 1 : 0);
  return (
    <>
      {showStats ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard
            label={statLabel}
            value={euro(totals.total)}
            tone={totals.total > 0 ? "bad" : "good"}
          />
          <StatCard
            label="Lignes hors tolérance"
            value={String(totals.anomalies)}
            tone={totals.anomalies ? "warn" : "good"}
          />
          <StatCard
            label={unmatchedLabel}
            value={String(totals.unmatched)}
            tone={totals.unmatched ? "warn" : "good"}
          />
        </div>
      ) : null}

      <DataTableCard
        title={cardTitle}
        busy={Boolean(isLoading) || ozegoLoading}
        busyLabel={isLoading ? "Chargement" : "Chargement des prix Ozego"}
        footer={footer}
        below={
          <EmptyState
            isLoading={isLoading}
            lines={lines}
            allLinesCount={allLinesCount}
            noLinesMessage={noLinesMessage}
          />
        }
      >
        <table className="w-full text-sm">
          <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {supplierName ? <SupplierHeader /> : null}
              {invoiceCell ? <th className="px-4 py-3 font-medium">Facture</th> : null}
              <th data-sticky="left" className="px-4 py-3 font-medium">
                Désignation fournisseur
              </th>
              <th className="px-4 py-3 font-medium">Identifiant Ozego</th>
              <th className="px-4 py-3 font-medium">{referenceColumnLabel}</th>
              <th className="px-4 py-3 font-medium">Unité de négo + nom du fournisseur</th>
              <th className="px-4 py-3 text-right font-medium">Qté</th>
              <th className="px-4 py-3 text-right font-medium">PU facturé</th>
              <th className="px-4 py-3 text-right font-medium">Cond.</th>
              <th className="px-4 py-3 text-right font-medium">PU comparable</th>
              <th className="px-4 py-3 text-right font-medium">PU référence</th>
              <th className="px-4 py-3 text-right font-medium">Écart</th>
              <th data-sticky="right" className="px-4 py-3 text-right font-medium">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? <TableSkeletonRows columns={11 + lead} /> : null}
            {lines.map((line) => {
              const row = rowFor(line);
              const { ozegoId, gap, out, locked } = ozegoLineView(line, row, tolerance, stage);
              const busy = isBusy?.(line) ?? false;
              const highlighted = highlightedId === line.id;
              const status = rowStatus(line);
              const pending = ozegoLoading && Boolean(ozegoId) && !row;
              return (
                <tr
                  key={line.id}
                  {...rowAttributes(line.id, out, highlighted)}
                  className={rowClass(out, busy, highlighted)}
                >
                  {supplierName ? <SupplierCell name={supplierName(line)} edge={status} /> : null}
                  {invoiceCell ? (
                    <td data-edge={supplierName ? undefined : status} className="px-4 py-3">
                      {invoiceCell(line)}
                    </td>
                  ) : null}
                  <DesignationCell line={line} status={status} edge={lead === 0}>
                    {line.catalog_products ? <MatchBadge line={line} /> : null}
                    {locked ? (
                      <span title={LOCKED_TITLE}>
                        <Lock className="size-3.5 text-muted-foreground" />
                        <span className="sr-only">{LOCKED_TITLE}</span>
                      </span>
                    ) : null}
                  </DesignationCell>
                  <td className="px-4 py-3">
                    {ozegoId ? (
                      <span className="block font-mono text-xs">{ozegoId}</span>
                    ) : (
                      <Badge variant="secondary" className="bg-warning/20 text-warning-foreground">
                        Sans identifiant
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {pending ? (
                      <CellSkeleton align="left" />
                    ) : row ? (
                      <div className="max-w-64">
                        <span className="line-clamp-2 break-words" title={row.label}>
                          {row.label}
                        </span>
                        <span
                          className="block truncate font-mono text-xs text-muted-foreground"
                          title={row.reference}
                        >
                          {row.reference}
                        </span>
                        <span
                          className="block truncate font-mono text-xs text-muted-foreground"
                          title={`Identifiant Ozego complet de l'offre : ${row.ozego_id}`}
                        >
                          {row.ozego_id}
                        </span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {pending ? (
                      <CellSkeleton align="left" />
                    ) : row ? (
                      <div className="max-w-48">
                        <span className="block truncate" title={row.unit ?? ""}>
                          {row.unit || "—"}
                        </span>
                        <span
                          className="block truncate text-xs text-muted-foreground"
                          title={row.supplier_name ?? ""}
                        >
                          {row.supplier_name ?? "—"}
                        </span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {locked || !onSaveLineField ? (
                      <ReadOnlyQuantity line={line} />
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <EditableCell
                          value={line.quantity}
                          title="Quantité facturée"
                          className="w-20"
                          onSave={(value) => onSaveLineField(line, { quantity: Number(value) })}
                        />
                        <EditableText
                          value={line.unit ?? ""}
                          title="Unité facturée (kg, carton, L…)"
                          className="w-16"
                          onSave={(value) => onSaveLineField(line, { unit: value || null })}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {locked || !onSaveLineField ? (
                      <span className="tabular-nums">{euro(line.unit_price)}</span>
                    ) : (
                      <EditableCell
                        value={line.unit_price}
                        title="Prix unitaire facturé"
                        className="ml-auto w-28"
                        format={priceInput}
                        onSave={(value) => onSaveLineField(line, { unit_price: value })}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {locked ? (
                      <span className="tabular-nums">×{normalizePackFactor(line.pack_factor)}</span>
                    ) : (
                      <PackFactorInput
                        value={normalizePackFactor(line.pack_factor)}
                        onSave={(value) => onSavePackFactor(line, value)}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {euro(comparableUnitPrice(line.unit_price, line.pack_factor))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {pending ? <CellSkeleton /> : euro(row?.price ?? null)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-medium tabular-nums ${
                      !gap
                        ? "text-muted-foreground"
                        : gap.unitGap > 0
                          ? "text-destructive"
                          : gap.unitGap < 0
                            ? "text-success"
                            : ""
                    }`}
                  >
                    {pending ? (
                      <CellSkeleton />
                    ) : gap ? (
                      <>
                        <span className="block">{euro(gap.totalGap)}</span>
                        <span className="block text-xs">{percent(gap.percentGap)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-sticky="right" className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={locked || busy}
                        title={locked ? LOCKED_TITLE : "Modifier la correspondance"}
                        onClick={() => onPick(line)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      {line.catalog_products ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={locked || busy}
                          title={locked ? LOCKED_TITLE : "Retirer la correspondance"}
                          onClick={() => onUnmatch(line)}
                        >
                          <X className="size-4 text-destructive" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
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
          <tfoot className="border-t-2 border-border bg-muted/60 font-medium">
            <tr>
              <td className="px-4 py-3" colSpan={5 + lead}>
                {totalLabel}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{euro(invoicedTotal)}</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {ozegoLoading ? <CellSkeleton /> : euro(totals.bestTotal)}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums ${totals.total > 0 ? "text-destructive" : totals.total < 0 ? "text-success" : ""}`}
              >
                {ozegoLoading ? <CellSkeleton /> : euro(totals.total)}
              </td>
              <td data-sticky="right" className="px-4 py-3" />
            </tr>
          </tfoot>
        </table>
      </DataTableCard>
    </>
  );
}
