import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, Search, X } from "lucide-react";

import { BulkActionBar, BulkResult, BulkToolbar } from "@/components/BulkSelection";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadError } from "@/components/DataTable";
import { GeneralMatchingTable } from "@/components/GeneralMatchingTable";
import { InvoiceCell } from "@/components/InvoiceCell";
import { NextToReviewButton } from "@/components/NextToReviewButton";
import { ProductPicker } from "@/components/ProductPicker";
import {
  FournisseurComparisonTable,
  OzegoComparisonTable,
} from "@/components/StageComparisonTable";
import { SectionTabPanel, SectionTabs, type SectionTabItem } from "@/components/SectionTabs";
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
import { Card, CardContent } from "@/components/ui/card";
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
import { activeFilterChips, visibleCountText } from "@/lib/filter-chips";
import { rematchInvoice } from "@/lib/invoices.functions";
import { toastError } from "@/lib/toast-error";
import { PROSPECT_MATCHING_LINES_KEY, type Stage } from "@/lib/line-actions";
import {
  canonicalizeComparatifSearch,
  etapeToTab,
  filtersFromSearch,
  searchPatchFromFilters,
  tabToEtape,
  type ComparatifSearch,
  type MatchingTab,
} from "@/lib/search-params";
import { useBulkValidation } from "@/lib/use-bulk-validation";
import { useDebouncedText } from "@/lib/use-debounced-text";
import {
  ALL,
  buildExportRows,
  countByStatus,
  DEFAULT_FILTERS,
  fetchAllRows,
  filterLines,
  filtersActive,
  invoiceOptions,
  paginate,
  type Page,
  rematchSequentially,
  ROW_STATUSES,
  sortLines,
  STATUS_LABEL,
  supplierOptions,
  type MatchingFilters,
  type MatchingLine,
  type RangeQuery,
  type RematchSummary,
  type ValidationFilter,
} from "@/lib/matching-view";
import { bestByOzegoFromVariants, fetchOzegoVariants } from "@/lib/ozego";
import {
  STAGE_EXPORT_FILE,
  STAGE_EXPORT_SHEET,
  buildStageExportRows,
  buildStageExportSummary,
} from "@/lib/stage-export";
import {
  bestRowFor,
  ozegoIdsOf,
  ozegoTableLabels,
  preferredRowFor,
  sumFournisseurGaps,
  sumOzegoGaps,
  sumPreferredGaps,
  sumReferencePrices,
  type OzegoData,
} from "@/lib/stage-rows";
import { matchingTabCounts } from "@/lib/tab-counts";
import { invalidateLineCaches, useLineActions } from "@/lib/use-line-actions";
import { useOzegoComparison } from "@/lib/use-ozego-comparison";
import { useReviewNavigation } from "@/lib/use-review-navigation";

const PAGE_SIZE = 50;
const GENERAL_STAGE: Stage = "fournisseur";

type Tab = MatchingTab;

const TABS: Array<{ id: Tab; label: string; countTitle: (count: number) => string }> = [
  { id: "general", label: "Rapprochements", countTitle: (count) => `${count} ligne(s)` },
  {
    id: "fournisseur",
    label: "Comparatif référence fournisseur",
    countTitle: (count) => `${count} ligne(s) à vérifier`,
  },
  {
    id: "ozego",
    label: "Ozego · Autres fournisseurs (moins cher)",
    countTitle: (count) => `${count} ligne(s) avec un identifiant Ozego`,
  },
  {
    id: "ozego-preferes",
    label: "Ozego · Fournisseurs préférés",
    countTitle: (count) => `${count} ligne(s) avec un identifiant Ozego`,
  },
];

const EMPTY_OZEGO_DATA: OzegoData = {
  bestByOzego: new Map(),
  variantsByOzego: new Map(),
  preferredSuppliers: [],
};

const LINES_SELECT =
  "id, invoice_id, line_number, supplier_reference, label, quantity, unit, unit_price, discount_percent, line_total, match_status, match_score, match_method, manual_override, pack_factor, matched_product_id, validated_stage, invoices!inner(id, supplier_name, file_name, invoice_number, invoice_date, currency, prospect_id), catalog_products(id, reference, label, price, unit, ean, family, currency, ozego_id, supplier_name)";

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
  tolerance,
  preferredSuppliers,
  search,
  onSearchChange,
}: {
  prospectId: string;
  prospectName: string;
  invoices: InvoiceSummary[];
  tolerance: number;
  preferredSuppliers: string[];
  /** Sous-onglet, filtres et page : ils vivent dans l'URL de la page du comparatif. */
  search: ComparatifSearch;
  onSearchChange: (change: Partial<ComparatifSearch>, replace: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const lineActions = useLineActions();
  const rematch = useServerFn(rematchInvoice);

  const tab = etapeToTab(search.etape);
  const [picking, setPicking] = useState<{ line: MatchingLine; stage: Stage } | null>(null);
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
  const invoiceChoices = useMemo(() => invoiceOptions(allLines), [allLines]);
  const supplierChoices = useMemo(() => supplierOptions(allLines), [allLines]);
  const known = useMemo(
    () => ({ invoiceIds: invoiceChoices.map((invoice) => invoice.id), suppliers: supplierChoices }),
    [invoiceChoices, supplierChoices],
  );
  // Une facture ou un fournisseur qui n'existe plus (lien périmé) compte comme « tous ».
  const filters = useMemo<MatchingFilters>(
    () =>
      filtersFromSearch(
        linesQuery.isSuccess ? canonicalizeComparatifSearch(search, known, search.page) : search,
      ),
    [search, known, linesQuery.isSuccess],
  );
  const deferredSearch = useDeferredValue(filters.search);
  const effective = useMemo(
    () => ({ ...filters, search: deferredSearch }),
    [filters, deferredSearch],
  );
  const filtered = useMemo(() => filterLines(allLines, effective), [allLines, effective]);
  const withoutStatus = useMemo(
    () => filterLines(allLines, { ...effective, status: ALL }),
    [allLines, effective],
  );
  const counts = useMemo(() => countByStatus(withoutStatus), [withoutStatus]);
  const tabCounts = useMemo(() => matchingTabCounts(withoutStatus), [withoutStatus]);
  const current = paginate(filtered, search.page, PAGE_SIZE);
  const setPage = useCallback((page: number) => onSearchChange({ page }, true), [onSearchChange]);
  const { goNext, highlightedId, trackingProps } = useReviewNavigation({
    lines: filtered,
    page: current.page,
    pageSize: PAGE_SIZE,
    onPageChange: setPage,
  });
  const [searchText, onSearchText] = useDebouncedText(search.q, (value) =>
    onSearchChange(searchPatchFromFilters({ search: value }), true),
  );

  const settled = linesQuery.isSuccess && !linesQuery.isFetching;
  useEffect(() => {
    if (!settled) return;
    const next = canonicalizeComparatifSearch(search, known, current.page);
    if (next !== search) {
      onSearchChange(
        { facture: next.facture, fournisseur: next.fournisseur, page: next.page },
        true,
      );
    }
  }, [settled, search, known, current.page, onSearchChange]);
  const active = filtersActive(filters);
  const chips = useMemo(
    () => activeFilterChips(filters, invoiceChoices),
    [filters, invoiceChoices],
  );
  const ozegoTab = tab === "ozego" || tab === "ozego-preferes";
  const {
    bestByOzego,
    variantsByOzego,
    isLoading: ozegoLoading,
  } = useOzegoComparison(ozegoIdsOf(current.items), ozegoTab);

  function updateFilters(patch: Partial<MatchingFilters>) {
    onSearchChange(searchPatchFromFilters(patch), true);
  }

  const contextFor = (line: MatchingLine) => ({
    invoiceId: line.invoice_id,
    prospectId,
    supplierName: line.invoices?.supplier_name ?? null,
  });

  const bulkEnabled = tab === "general" || tab === "fournisseur";
  const bulk = useBulkValidation<MatchingLine>({
    stage: GENERAL_STAGE,
    filteredLines: filtered,
    pageLines: current.items,
    contextFor,
    lineLabel: (line) => line.label,
    // L'onglet ou un filtre change : la sélection ne vaut plus pour la liste affichée.
    resetKey: [
      tab,
      filters.search,
      filters.status,
      filters.invoiceId,
      filters.supplier,
      filters.validation,
    ].join("\u0001"),
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

  async function ozegoDataFor(stage: Stage, lines: MatchingLine[]): Promise<OzegoData> {
    const data = { ...EMPTY_OZEGO_DATA, preferredSuppliers };
    if (stage === "fournisseur") return data;
    const ids = ozegoIdsOf(lines);
    const variantsByOzego = await fetchOzegoVariants(ids);
    return stage === "ozego"
      ? { ...data, bestByOzego: bestByOzegoFromVariants(variantsByOzego) }
      : { ...data, variantsByOzego };
  }

  async function exportExcel(lines: MatchingLine[], scope: string) {
    if (lines.length === 0) {
      toast.error("Aucune ligne à exporter");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const stage = tab === "general" ? null : tab;
      const data = stage ? await ozegoDataFor(stage, lines) : EMPTY_OZEGO_DATA;
      const rows = stage
        ? buildStageExportRows(stage, lines, data, tolerance)
        : buildExportRows(lines);
      const sheet = XLSX.utils.json_to_sheet(rows);
      if (stage) {
        XLSX.utils.sheet_add_aoa(sheet, buildStageExportSummary(stage, lines, data, tolerance), {
          origin: -1,
        });
      }
      sheet["!cols"] = Object.keys(rows[0]!).map((key) => ({ wch: Math.max(14, key.length + 2) }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        sheet,
        stage ? STAGE_EXPORT_SHEET[stage] : "Rapprochements",
      );
      const name = prospectName.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
      const stem = stage ? STAGE_EXPORT_FILE[stage] : "rapprochements";
      XLSX.writeFile(book, `${stem}-${scope}-${name || "prospect"}.xlsx`);
    } catch (error) {
      toastError(error);
    }
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

  const pageActions = (stage: Stage) => ({
    allLinesCount: allLines.length,
    isLoading: linesQuery.isLoading,
    noLinesMessage: "Aucune ligne extraite pour ce prospect.",
    tolerance,
    onSavePackFactor: (line: MatchingLine, value: number) =>
      void withBusy(line, () => lineActions.savePackFactor(line, contextFor(line), value)),
    onPick: (line: MatchingLine) => setPicking({ line, stage }),
    onUnmatch: (line: MatchingLine) =>
      void withBusy(line, () => lineActions.applyMatch(line, contextFor(line), null, stage)),
    onDelete: (line: MatchingLine) =>
      void withBusy(line, () => lineActions.deleteLine(line, contextFor(line))),
    invoiceCell: (line: MatchingLine) => <InvoiceCell line={line} />,
    isBusy: (line: MatchingLine) => busy.has(line.id),
    highlightedId,
    showStats: false,
    totalLabel: "Total de la page",
    footer: <PaginationBar current={current} onPage={setPage} />,
  });

  const pageLines = current.items;
  const confirmLine = (line: MatchingLine) =>
    void withBusy(line, () => lineActions.confirm(line, contextFor(line)));

  const loadError = linesQuery.error ? (
    <LoadError message={linesQuery.error.message} onRetry={() => void linesQuery.refetch()} />
  ) : null;

  const bulkToolbar = (
    <BulkToolbar
      threshold={bulk.threshold}
      onThresholdChange={bulk.setThreshold}
      onSelectAboveScore={bulk.selectAboveScore}
      filteredCount={bulk.eligibleCount}
      selectedCount={bulk.selectedCount}
      onSelectAllFiltered={bulk.selectAllFiltered}
      disabled={bulk.progress !== null}
    />
  );

  function renderStageTable() {
    if (linesQuery.error) {
      return (
        <Card>
          <CardContent className="p-0">{loadError}</CardContent>
        </Card>
      );
    }
    if (tab === "fournisseur") {
      const { invoicedTotal, catalogTotal } = sumReferencePrices(pageLines, bestByOzego);
      return (
        <FournisseurComparisonTable
          {...pageActions("fournisseur")}
          lines={pageLines}
          totals={sumFournisseurGaps(pageLines, tolerance)}
          invoicedTotal={invoicedTotal}
          catalogTotal={catalogTotal}
          onConfirm={confirmLine}
          selection={bulk.selection}
          toolbar={bulkToolbar}
        />
      );
    }
    if (tab === "ozego") {
      const { invoicedTotal, bestTotal } = sumReferencePrices(pageLines, bestByOzego);
      return (
        <OzegoComparisonTable
          {...pageActions("ozego")}
          {...ozegoTableLabels("ozego", preferredSuppliers.length)}
          lines={pageLines}
          stage="ozego"
          ozegoLoading={ozegoLoading}
          rowFor={(line) => bestRowFor(line, bestByOzego)}
          totals={{ ...sumOzegoGaps(pageLines, bestByOzego, tolerance), bestTotal }}
          invoicedTotal={invoicedTotal}
        />
      );
    }
    const { invoicedTotal } = sumReferencePrices(pageLines, bestByOzego);
    return (
      <OzegoComparisonTable
        {...pageActions("ozego-preferes")}
        {...ozegoTableLabels("ozego-preferes", preferredSuppliers.length)}
        lines={pageLines}
        stage="ozego-preferes"
        ozegoLoading={ozegoLoading}
        rowFor={(line) => preferredRowFor(line, variantsByOzego, preferredSuppliers)}
        totals={sumPreferredGaps(pageLines, variantsByOzego, preferredSuppliers, tolerance)}
        invoicedTotal={invoicedTotal}
      />
    );
  }

  const tabItems: ReadonlyArray<SectionTabItem<Tab>> = TABS.map((item) => ({
    id: item.id,
    label: item.label,
    count: linesQuery.data ? tabCounts[item.id] : null,
    countTitle: item.countTitle(tabCounts[item.id]),
  }));

  return (
    <div {...trackingProps}>
      <SectionTabs
        tabs={tabItems}
        value={tab}
        onValueChange={(next) => onSearchChange({ etape: tabToEtape(next) }, false)}
        label="Étapes de la vue des rapprochements"
        className="space-y-6"
      >
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

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div
              role="group"
              aria-label="Recherche"
              className="flex w-full flex-wrap items-center gap-2 lg:w-auto"
            >
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchText}
                  onChange={(event) => onSearchText(event.target.value)}
                  placeholder="Rechercher par référence, désignation, produit…"
                  aria-label="Rechercher une ligne"
                  className="pl-8"
                />
              </div>
              <NextToReviewButton onClick={goNext} />
            </div>
            <div
              role="group"
              aria-label="Filtres"
              className="flex w-full flex-wrap items-center gap-2 lg:w-auto"
            >
              <Select
                value={filters.invoiceId}
                onValueChange={(value) => updateFilters({ invoiceId: value })}
              >
                <SelectTrigger className="w-full sm:w-52" aria-label="Filtrer par facture">
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
                <SelectTrigger
                  className="w-full sm:w-48"
                  aria-label="Filtrer par fournisseur de la facture"
                >
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
                <SelectTrigger className="w-full sm:w-48" aria-label="Filtrer par validation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Validées ou non</SelectItem>
                  <SelectItem value="validated">Lignes validées</SelectItem>
                  <SelectItem value="unvalidated">Lignes non validées</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div
              role="group"
              aria-label="Exports et re-rapprochement"
              className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto"
            >
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

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <p className="tabular-nums text-muted-foreground" aria-live="polite">
              {linesQuery.data ? visibleCountText(filtered.length, allLines.length) : " "}
            </p>
            {chips.map((chip) => (
              <Badge
                key={chip.key}
                variant="secondary"
                className="max-w-full gap-1 py-0.5 pl-2.5 pr-1 font-normal"
              >
                <span className="truncate" title={chip.label}>
                  {chip.label}
                </span>
                <button
                  type="button"
                  aria-label={`Retirer le filtre ${chip.label}`}
                  className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => updateFilters(chip.patch)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            {active ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSearchChange(searchPatchFromFilters(DEFAULT_FILTERS), true)}
              >
                Réinitialiser les filtres
              </Button>
            ) : null}
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

        {tab === "ozego-preferes" ? (
          <p className="text-sm text-muted-foreground">
            {preferredSuppliers.length === 0
              ? "Aucun fournisseur préféré défini pour ce comparatif : l'offre la moins chère de tous les fournisseurs est affichée. Ils se définissent dans la section « Fournisseurs préférés » du comparatif."
              : `Fournisseurs préférés : ${preferredSuppliers.join(", ")}`}
          </p>
        ) : null}

        <SectionTabPanel value={tab}>
          {tab !== "general" ? (
            renderStageTable()
          ) : (
            <GeneralMatchingTable
              lines={current.items}
              allLinesCount={allLines.length}
              isLoading={linesQuery.isLoading}
              error={loadError}
              isBusy={(line) => busy.has(line.id)}
              highlightedId={highlightedId}
              selection={bulk.selection}
              toolbar={bulkToolbar}
              footer={<PaginationBar current={current} onPage={setPage} />}
              onSavePackFactor={(line, value) =>
                void withBusy(line, () => lineActions.savePackFactor(line, contextFor(line), value))
              }
              onPick={(line) => setPicking({ line, stage: GENERAL_STAGE })}
              onConfirm={confirmLine}
              onUnmatch={(line) =>
                void withBusy(line, () =>
                  lineActions.applyMatch(line, contextFor(line), null, GENERAL_STAGE),
                )
              }
              onDelete={(line) =>
                void withBusy(line, () => lineActions.deleteLine(line, contextFor(line)))
              }
            />
          )}
          {bulkEnabled && bulk.report ? (
            <BulkResult
              summary={bulk.report.summary}
              failures={bulk.report.failures}
              onDismiss={bulk.dismissReport}
            />
          ) : null}
          {bulkEnabled ? (
            <BulkActionBar
              count={bulk.selectedCount}
              progress={bulk.progress}
              onValidate={bulk.requestValidate}
              onClear={bulk.clear}
            />
          ) : null}
        </SectionTabPanel>

        <ConfirmDialog
          open={bulk.confirmOpen}
          onOpenChange={bulk.setConfirmOpen}
          title={`Valider ${bulk.selectedCount} lignes ?`}
          confirmLabel={`Valider ${bulk.selectedCount} lignes`}
          onConfirm={bulk.confirmValidate}
        >
          <p>
            Les {bulk.selectedCount} lignes sélectionnées passeront à l'état « Validé » à l'étape «
            Référence fournisseur ». Un bouton « Annuler » restera disponible pendant 6 secondes.
          </p>
        </ConfirmDialog>

        {picking ? (
          <ProductPicker
            open
            onOpenChange={(open) => !open && setPicking(null)}
            initialSearch={picking.line.supplier_reference || picking.line.label}
            supplierReference={picking.line.supplier_reference}
            supplierLabel={picking.line.label}
            onPick={(product) =>
              void withBusy(picking.line, () =>
                lineActions.applyMatch(
                  picking.line,
                  contextFor(picking.line),
                  product,
                  picking.stage,
                ),
              )
            }
          />
        ) : null}
      </SectionTabs>
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

function PaginationBar({
  current,
  onPage,
}: {
  current: Page<unknown>;
  onPage: (page: number) => void;
}) {
  return (
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
          onClick={() => onPage(current.page - 1)}
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
          onClick={() => onPage(current.page + 1)}
        >
          Suivant
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
