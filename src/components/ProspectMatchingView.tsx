import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { PackFactorInput } from "@/components/PackFactorInput";
import { ProductPicker } from "@/components/ProductPicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { euro, num, shortDate } from "@/lib/format";
import { rematchInvoice } from "@/lib/invoices.functions";
import { PROSPECT_MATCHING_LINES_KEY, stageLabel, type Stage } from "@/lib/line-actions";
import {
  ALL,
  buildExportRows,
  countByStatus,
  DEFAULT_FILTERS,
  fetchAllRows,
  filterLines,
  filtersActive,
  invoiceOptions,
  invoiceTitle,
  isValidated,
  methodLabel,
  paginate,
  rematchSequentially,
  ROW_STATUSES,
  rowStatus,
  sortLines,
  STATUS_LABEL,
  supplierLabel,
  supplierOptions,
  type MatchingFilters,
  type MatchingLine,
  type RangeQuery,
  type RematchSummary,
  type RowStatus,
  type ValidationFilter,
} from "@/lib/matching-view";
import { normalizePackFactor } from "@/lib/pack";
import { invalidateLineCaches, useLineActions } from "@/lib/use-line-actions";

const PAGE_SIZE = 50;
const STAGE: Stage = "fournisseur";

const LINES_SELECT =
  "id, invoice_id, line_number, supplier_reference, label, quantity, unit, unit_price, discount_percent, line_total, match_status, match_score, match_method, manual_override, pack_factor, matched_product_id, validated_stage, invoices!inner(id, supplier_name, file_name, invoice_number, invoice_date, currency, prospect_id), catalog_products(id, reference, label, price, unit, ean, family, currency, ozego_id, supplier_name)";

const STATUS_CLASS: Record<RowStatus, string> = {
  confirmed: "bg-success/15 text-success",
  review: "bg-warning/20 text-warning-foreground",
  unmatched: "bg-destructive/10 text-destructive",
};

type InvoiceSummary = {
  id: string;
  status: string;
  supplier_name: string | null;
  file_name: string | null;
};

export function ProspectMatchingView({
  prospectId,
  prospectName,
  invoices,
}: {
  prospectId: string;
  prospectName: string;
  invoices: InvoiceSummary[];
}) {
  const queryClient = useQueryClient();
  const lineActions = useLineActions();
  const rematch = useServerFn(rematchInvoice);

  const [filters, setFilters] = useState<MatchingFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [picking, setPicking] = useState<MatchingLine | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null,
  );
  const [lastRematch, setLastRematch] = useState<RematchSummary | null>(null);

  const linesQuery = useQuery({
    queryKey: [PROSPECT_MATCHING_LINES_KEY, prospectId],
    queryFn: () =>
      fetchAllRows<MatchingLine>(
        () =>
          supabase
            .from("invoice_lines")
            .select(LINES_SELECT)
            .eq("invoices.prospect_id", prospectId)
            .eq("excluded", false)
            .order("id") as unknown as RangeQuery<MatchingLine>,
      ),
  });

  const allLines = useMemo(() => sortLines(linesQuery.data ?? []), [linesQuery.data]);
  const deferredSearch = useDeferredValue(filters.search);
  const effective = useMemo(
    () => ({ ...filters, search: deferredSearch }),
    [filters, deferredSearch],
  );
  const filtered = useMemo(() => filterLines(allLines, effective), [allLines, effective]);
  const counts = useMemo(
    () => countByStatus(filterLines(allLines, { ...effective, status: ALL })),
    [allLines, effective],
  );
  const invoiceChoices = useMemo(() => invoiceOptions(allLines), [allLines]);
  const supplierChoices = useMemo(() => supplierOptions(allLines), [allLines]);
  const current = paginate(filtered, page, PAGE_SIZE);
  const active = filtersActive(filters);

  function updateFilters(patch: Partial<MatchingFilters>) {
    setFilters((previous) => ({ ...previous, ...patch }));
    setPage(1);
  }

  const contextFor = (line: MatchingLine) => ({
    invoiceId: line.invoice_id,
    prospectId,
    supplierName: line.invoices?.supplier_name ?? null,
  });

  async function withBusy(line: MatchingLine, action: () => Promise<void>) {
    setBusy((previous) => new Set(previous).add(line.id));
    try {
      await action();
    } finally {
      setBusy((previous) => {
        const next = new Set(previous);
        next.delete(line.id);
        return next;
      });
    }
  }

  async function exportExcel(lines: MatchingLine[], scope: string) {
    if (lines.length === 0) {
      toast.error("Aucune ligne à exporter");
      return;
    }
    const XLSX = await import("xlsx");
    const rows = buildExportRows(lines);
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = Object.keys(rows[0]!).map((key) => ({ wch: Math.max(14, key.length + 2) }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Rapprochements");
    const name = prospectName.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    XLSX.writeFile(book, `rapprochements-${scope}-${name || "prospect"}.xlsx`);
  }

  const processedInvoices = invoices.filter((invoice) => invoice.status === "processed");

  async function rematchAll() {
    const targets = processedInvoices.map((invoice) => ({
      id: invoice.id,
      label: invoice.supplier_name || invoice.file_name || "Facture",
    }));
    if (targets.length === 0) {
      toast.error("Aucune facture analysée à re-rapprocher");
      return;
    }
    setLastRematch(null);
    setProgress({ done: 0, total: targets.length, current: targets[0]!.label });
    const summary = await rematchSequentially(
      targets,
      (invoiceId) => rematch({ data: { invoiceId } }),
      (done, total, label) => setProgress({ done, total, current: label ?? "" }),
    );
    setProgress(null);
    setLastRematch(summary);
    for (const { id: invoiceId } of targets) {
      invalidateLineCaches(queryClient, { invoiceId, prospectId }, { ozego: true });
    }
    if (summary.failed.length === 0) {
      toast.success(
        `${summary.succeeded} facture(s) re-rapprochée(s), ${summary.updatedLines} ligne(s) mise(s) à jour`,
      );
    } else {
      toast.error(
        `${summary.failed.length} facture(s) en échec sur ${summary.total} : ${summary.failed
          .map((failure) => `${failure.label} (${failure.message})`)
          .join(" ; ")}`,
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <CounterCard
          label="Toutes les lignes"
          value={counts.all}
          selected={filters.status === ALL}
          onClick={() => updateFilters({ status: ALL })}
        />
        {ROW_STATUSES.map((status) => (
          <CounterCard
            key={status}
            label={STATUS_LABEL[status]}
            value={counts[status]}
            selected={filters.status === status}
            onClick={() => updateFilters({ status: filters.status === status ? ALL : status })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
            placeholder="Rechercher par référence, désignation, produit…"
            className="pl-8"
          />
        </div>
        <Select
          value={filters.invoiceId}
          onValueChange={(value) => updateFilters({ invoiceId: value })}
        >
          <SelectTrigger className="w-56" aria-label="Filtrer par facture">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toutes les factures</SelectItem>
            {invoiceChoices.map((invoice) => (
              <SelectItem key={invoice.id} value={invoice.id}>
                {invoice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.supplier}
          onValueChange={(value) => updateFilters({ supplier: value })}
        >
          <SelectTrigger className="w-48" aria-label="Filtrer par fournisseur de la facture">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les fournisseurs</SelectItem>
            {supplierChoices.map((supplier) => (
              <SelectItem key={supplier} value={supplier}>
                {supplier}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.validation}
          onValueChange={(value) => updateFilters({ validation: value as ValidationFilter })}
        >
          <SelectTrigger className="w-48" aria-label="Filtrer par validation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Validées ou non</SelectItem>
            <SelectItem value="validated">Lignes validées</SelectItem>
            <SelectItem value="unvalidated">Lignes non validées</SelectItem>
          </SelectContent>
        </Select>
        {active ? (
          <Button
            variant="ghost"
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
              setPage(1);
            }}
          >
            Réinitialiser les filtres
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          {active ? (
            <Button
              variant="outline"
              onClick={() => void exportExcel(filtered, "filtre")}
              disabled={filtered.length === 0}
            >
              <Download className="size-4" />
              Exporter la sélection ({filtered.length})
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => void exportExcel(allLines, "complet")}
            disabled={allLines.length === 0}
          >
            <Download className="size-4" />
            Exporter tout ({allLines.length})
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary" disabled={progress !== null}>
                {progress ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Re-rapprocher toutes les factures
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Re-rapprocher toutes les factures ?</AlertDialogTitle>
                <AlertDialogDescription>
                  {processedInvoices.length} facture(s) analysée(s) seront re-rapprochées l'une
                  après l'autre. Les lignes déjà corrigées ou validées à la main ne sont pas
                  modifiées.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => void rematchAll()}>
                  Lancer le re-rapprochement
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {progress ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm">
              Re-rapprochement : facture {Math.min(progress.done + 1, progress.total)} /{" "}
              {progress.total}
              {progress.current ? ` · ${progress.current}` : ""}
            </p>
            <Progress value={(progress.done / progress.total) * 100} />
          </CardContent>
        </Card>
      ) : null}

      {lastRematch ? (
        <Card>
          <CardContent className="space-y-1 pt-6 text-sm">
            <p>
              Dernier re-rapprochement : {lastRematch.succeeded}/{lastRematch.total} facture(s)
              traitée(s), {lastRematch.updatedLines} ligne(s) mise(s) à jour.
            </p>
            {lastRematch.failed.map((failure) => (
              <p key={failure.invoiceId} className="text-destructive">
                {failure.label} : {failure.message}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Tous les rapprochements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Facture</th>
                  <th className="px-4 py-3 font-medium">Désignation fournisseur</th>
                  <th className="px-4 py-3 text-right font-medium">Qté</th>
                  <th className="px-4 py-3 text-right font-medium">PU facturé</th>
                  <th className="px-4 py-3 text-right font-medium">Cond.</th>
                  <th className="px-4 py-3 font-medium">Produit rapproché</th>
                  <th className="px-4 py-3 font-medium">Rapprochement</th>
                  <th className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {current.items.map((line) => {
                  const product = line.catalog_products;
                  const status = rowStatus(line);
                  const working = busy.has(line.id);
                  const validatedAt = stageLabel(line.validated_stage);
                  return (
                    <tr key={line.id} className={working ? "opacity-60" : undefined}>
                      <td className="px-4 py-3">
                        <Link
                          to="/factures/$id"
                          params={{ id: line.invoice_id }}
                          className="block font-medium hover:text-primary"
                        >
                          {invoiceTitle(line.invoices)}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {supplierLabel(line)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {line.invoices?.invoice_number
                            ? `N° ${line.invoices.invoice_number} · `
                            : ""}
                          {shortDate(line.invoices?.invoice_date)} · ligne {line.line_number}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block font-medium">{line.label}</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {line.supplier_reference || "sans référence"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {num(line.quantity)}
                        {line.unit ? (
                          <span className="ml-1 text-xs text-muted-foreground">{line.unit}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{euro(line.unit_price)}</td>
                      <td className="px-4 py-3 text-right">
                        <PackFactorInput
                          value={normalizePackFactor(line.pack_factor)}
                          onSave={(value) =>
                            void withBusy(line, () =>
                              lineActions.savePackFactor(line, contextFor(line), value),
                            )
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        {product ? (
                          <>
                            <span className="block">{product.label}</span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {product.reference}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {product.supplier_name ?? "—"}
                            </span>
                            <span
                              className="block font-mono text-xs text-muted-foreground"
                              title="Identifiant Ozego complet"
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
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={STATUS_CLASS[status]}>
                          {STATUS_LABEL[status]}
                        </Badge>
                        {product ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
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
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {product && !isValidated(line) ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={working}
                              title="Valider la correspondance"
                              onClick={() =>
                                void withBusy(line, () =>
                                  lineActions.confirm(line, contextFor(line)),
                                )
                              }
                            >
                              <Check className="size-4 text-success" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={working}
                            title="Modifier la correspondance"
                            onClick={() => setPicking(line)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          {product ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={working}
                              title="Retirer la correspondance"
                              onClick={() =>
                                void withBusy(line, () =>
                                  lineActions.applyMatch(line, contextFor(line), null, STAGE),
                                )
                              }
                            >
                              <X className="size-4 text-destructive" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={working}
                            title="Supprimer la ligne"
                            onClick={() =>
                              void withBusy(line, () =>
                                lineActions.deleteLine(line, contextFor(line)),
                              )
                            }
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
            {linesQuery.isLoading ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Chargement…</p>
            ) : linesQuery.error ? (
              <div className="flex items-center gap-3 px-4 py-6 text-sm text-destructive">
                <span>Impossible de charger les lignes : {linesQuery.error.message}</span>
                <Button variant="outline" size="sm" onClick={() => void linesQuery.refetch()}>
                  Réessayer
                </Button>
              </div>
            ) : current.total === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                {allLines.length === 0
                  ? "Aucune ligne extraite pour ce prospect."
                  : "Aucune ligne ne correspond aux filtres."}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <span>
              {current.total === 0
                ? "0 ligne"
                : `Lignes ${current.from} à ${current.to} sur ${current.total}`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={current.page <= 1}
                onClick={() => setPage(current.page - 1)}
              >
                <ChevronLeft className="size-4" />
                Précédent
              </Button>
              <span className="tabular-nums">
                Page {current.page} / {current.pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={current.page >= current.pageCount}
                onClick={() => setPage(current.page + 1)}
              >
                Suivant
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {picking ? (
        <ProductPicker
          open
          onOpenChange={(open) => !open && setPicking(null)}
          initialSearch={picking.supplier_reference || picking.label}
          onPick={(product) =>
            void withBusy(picking, () =>
              lineActions.applyMatch(picking, contextFor(picking), product, STAGE),
            )
          }
        />
      ) : null}
    </div>
  );
}

function CounterCard({
  label,
  value,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/30 ${
        selected ? "border-primary" : "border-border"
      }`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
    </button>
  );
}
