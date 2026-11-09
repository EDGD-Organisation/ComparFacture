import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2, RefreshCw, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { CrumbText } from "@/components/CrumbText";
import { BulkActionBar, BulkResult, BulkToolbar } from "@/components/BulkSelection";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTableCard, TableMessage, TableSkeletonRows } from "@/components/DataTable";
import { NextToReviewButton } from "@/components/NextToReviewButton";
import { ProductPicker, type PickedProduct } from "@/components/ProductPicker";
import {
  FournisseurComparisonTable,
  OzegoComparisonTable,
  StatCard,
} from "@/components/StageComparisonTable";
import { SectionTabPanel, SectionTabs, type SectionTabItem } from "@/components/SectionTabs";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { rematchInvoice } from "@/lib/invoices.functions";
import { euro, lineGap, num, percent, shortDate } from "@/lib/format";
import { toastError } from "@/lib/toast-error";
import { type Stage } from "@/lib/line-actions";
import { comparableUnitPrice, normalizePackFactor } from "@/lib/pack";
import { ozegoGap } from "@/lib/ozego";
import { prospectQueryOptions } from "@/lib/prospect-query";
import {
  backToComparatifSearch,
  parseFactureSearch,
  patchFactureSearch,
  validateFactureSearch,
  type FactureSearch,
  type Mode,
} from "@/lib/search-params";
import { useBulkValidation } from "@/lib/use-bulk-validation";
import { useDebouncedText } from "@/lib/use-debounced-text";
import {
  bestRowFor,
  ozegoIdsOf,
  ozegoTableLabels,
  preferredRowFor as preferredRowOf,
  sumFournisseurGaps,
  sumOzegoGaps,
  sumPreferredGaps,
  sumReferencePrices,
} from "@/lib/stage-rows";
import { invoiceModeCounts } from "@/lib/tab-counts";
import { invalidateLineCaches, useLineActions } from "@/lib/use-line-actions";
import { useOzegoComparison } from "@/lib/use-ozego-comparison";
import { HIGHLIGHT_ROW_CLASS, useReviewNavigation } from "@/lib/use-review-navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/factures/$id")({
  head: () => ({
    meta: [
      { title: "Comparatif de facture — comparateur test Ozego" },
      {
        name: "description",
        content:
          "Comparez ligne par ligne les prix facturés et les prix catalogue, et corrigez les rapprochements produits.",
      },
      { property: "og:title", content: "Comparatif de facture — comparateur test Ozego" },
      {
        property: "og:description",
        content: "Écarts de prix ligne par ligne et rapprochement produit modifiable.",
      },
    ],
  }),
  validateSearch: validateFactureSearch,
  component: InvoiceDetail,
});

type Line = {
  id: string;
  line_number: number;
  supplier_reference: string | null;
  label: string;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  discount_percent: number | null;
  line_total: number | null;
  match_status: string;
  match_score: number | null;
  match_method: string | null;
  manual_override: boolean;
  pack_factor: number | null;
  matched_product_id: string | null;
  validated_stage: string | null;
  catalog_products: {
    id: string;
    reference: string;
    label: string;
    price: number | null;
    unit: string | null;
    ean: string | null;
    family: string | null;
    currency: string | null;
    ozego_id: string | null;
    supplier_name: string | null;
  } | null;
};

type StatusFilter = FactureSearch["statut"];

const MODES: Array<{ id: Mode; label: string; countTitle: (count: number) => string }> = [
  { id: "achat", label: "Achat client", countTitle: (count) => `${count} ligne(s)` },
  { id: "recap", label: "Récapitulatif", countTitle: (count) => `${count} ligne(s)` },
  {
    id: "fournisseur",
    label: "Comparatif référence fournisseur",
    countTitle: (count) => `${count} ligne(s) à vérifier`,
  },
  {
    id: "ozego",
    label: "Ozego · Autres fournisseurs (moins cher)",
    countTitle: (count) => `${count} ligne(s)`,
  },
  {
    id: "ozego-preferes",
    label: "Ozego · Fournisseurs préférés",
    countTitle: (count) => `${count} ligne(s)`,
  },
];

function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function lineMatchesFilters(line: Line, search: string, statusFilter: StatusFilter): boolean {
  if (statusFilter === "validated" && line.match_status !== "confirmed") return false;
  if (statusFilter === "unvalidated" && line.match_status === "confirmed") return false;

  const needle = normalizeForSearch(search.trim());
  if (!needle) return true;
  const haystack = normalizeForSearch(
    [
      line.label,
      line.supplier_reference,
      line.catalog_products?.label,
      line.catalog_products?.reference,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return haystack.includes(needle);
}

function InvoiceDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState<Line | null>(null);
  const navigate = Route.useNavigate();
  const rawSearch = Route.useSearch();
  const {
    mode,
    q: search,
    statut: statusFilter,
  } = useMemo(() => parseFactureSearch(rawSearch), [rawSearch]);
  /** Onglet : entrée d'historique (replace false). Recherche et filtre : replace true. */
  const updateSearch = useCallback(
    (patch: Partial<FactureSearch>, replace: boolean) => {
      void navigate({
        search: (prev) => patchFactureSearch(prev, patch),
        replace,
        resetScroll: false,
        state: true,
      });
    },
    [navigate],
  );
  const [searchText, onSearchText] = useDebouncedText(search, (value) =>
    updateSearch({ q: value }, true),
  );
  const historyState = useLocation({ select: (location) => location.state });
  const rematch = useServerFn(rematchInvoice);

  const invoiceQuery = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*").eq("id", id).single();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("tolerance_percent")
        .maybeSingle();
      return data;
    },
  });

  const linesQuery = useQuery({
    queryKey: ["invoice-lines", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select(
          "id, line_number, supplier_reference, label, quantity, unit, unit_price, discount_percent, line_total, match_status, match_score, match_method, manual_override, pack_factor, matched_product_id, validated_stage, catalog_products(id, reference, label, price, unit, ean, family, currency, ozego_id, supplier_name)",
        )
        .eq("invoice_id", id)
        .eq("excluded", false)
        .order("line_number");
      if (error) throw new Error(error.message);
      return data as unknown as Line[];
    },
  });

  const ozegoIds = ozegoIdsOf(linesQuery.data ?? []);

  const { bestByOzego, variantsByOzego, isLoading: ozegoLoading } = useOzegoComparison(ozegoIds);

  const prospectId = invoiceQuery.data?.prospect_id;
  const preferredSuppliersQuery = useQuery({
    queryKey: ["prospect-preferred-suppliers", prospectId],
    enabled: Boolean(prospectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .select("preferred_suppliers")
        .eq("id", prospectId!)
        .single();
      if (error) throw new Error(error.message);
      return data.preferred_suppliers ?? [];
    },
  });

  const prospectQuery = useQuery({
    ...prospectQueryOptions(prospectId ?? ""),
    enabled: Boolean(prospectId),
  });

  const relaunch = useMutation({
    mutationFn: () => rematch({ data: { invoiceId: id } }),
    onSuccess: () => {
      toast.success("Rapprochement relancé");
      invalidateLineCaches(queryClient, lineContext(), { ozego: false });
    },
    onError: (error: Error) => toastError(error),
  });

  async function viewInvoiceFile(path: string | null | undefined) {
    if (!path) {
      toast.error("Aucun fichier associé à cette facture");
      return;
    }
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toastError(error, "Impossible d'ouvrir le fichier");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const lineActions = useLineActions();
  const lineContext = () => ({
    invoiceId: id,
    prospectId: invoiceQuery.data?.prospect_id ?? null,
    supplierName: invoiceQuery.data?.supplier_name ?? null,
  });

  const applyMatch = (line: Line, product: PickedProduct | null, stage: Stage) =>
    lineActions.applyMatch(line, lineContext(), product, stage);
  const confirm = (line: Line) => lineActions.confirm(line, lineContext());
  const deleteLine = (line: Line) => lineActions.deleteLine(line, lineContext());

  async function saveLineField(
    line: Line,
    patch: Partial<Pick<Line, "quantity" | "unit" | "unit_price">>,
  ) {
    const quantity = patch.quantity ?? line.quantity;
    const unitPrice = patch.unit_price !== undefined ? patch.unit_price : line.unit_price;
    const recompute = patch.quantity !== undefined || patch.unit_price !== undefined;
    const { error } = await supabase
      .from("invoice_lines")
      .update({
        ...patch,
        ...(recompute
          ? {
              line_total: unitPrice === null ? null : Number((quantity * unitPrice).toFixed(4)),
            }
          : {}),
      })
      .eq("id", line.id);
    if (error) {
      toastError(error);
      return;
    }
    invalidateLineCaches(queryClient, lineContext(), { ozego: false });
  }

  const savePackFactor = (line: Line, value: number) =>
    lineActions.savePackFactor(line, lineContext(), value);

  const invoice = invoiceQuery.data;
  const lines = linesQuery.data ?? [];
  const visibleLines = lines.filter((line) => lineMatchesFilters(line, search, statusFilter));
  const tolerance = settingsQuery.data?.tolerance_percent ?? 2;
  const modeCounts = invoiceModeCounts(lines);
  const modeTabs: ReadonlyArray<SectionTabItem<Mode>> = MODES.map((item) => ({
    id: item.id,
    label: item.label,
    count: linesQuery.data ? modeCounts[item.id] : null,
    countTitle: item.countTitle(modeCounts[item.id]),
  }));
  const { goNext, highlightedId, trackingProps } = useReviewNavigation({ lines: visibleLines });
  const bulk = useBulkValidation<Line>({
    stage: "fournisseur",
    filteredLines: visibleLines,
    pageLines: visibleLines,
    contextFor: lineContext,
    lineLabel: (line) => line.label,
    // Le mode ou un filtre change : la sélection ne vaut plus pour la liste affichée.
    resetKey: [mode, search, statusFilter].join(""),
  });

  const totals = sumFournisseurGaps(lines, tolerance);

  const ozegoTotals = sumOzegoGaps(lines, bestByOzego, tolerance);

  const { invoicedTotal, catalogTotal, bestTotal } = sumReferencePrices(lines, bestByOzego);

  const preferredSuppliers = preferredSuppliersQuery.data ?? [];

  const preferredRowFor = (line: Line) => preferredRowOf(line, variantsByOzego, preferredSuppliers);

  const preferredTotals = sumPreferredGaps(lines, variantsByOzego, preferredSuppliers, tolerance);

  async function exportExcel() {
    if (lines.length === 0) {
      toast.error("Aucune ligne à exporter");
      return;
    }
    const XLSX = await import("xlsx");

    let invoicedTotal = 0;
    let catalogTotal = 0;

    const rows = lines.map((line) => {
      const catalogPrice = line.catalog_products?.price ?? null;
      const gap = lineGap(line.unit_price, catalogPrice, line.quantity, line.pack_factor);
      const k = gap?.packFactor ?? normalizePackFactor(line.pack_factor);
      const lineInvoiced = (line.unit_price ?? 0) * line.quantity;
      const lineCatalog = gap ? (catalogPrice ?? 0) * line.quantity * k : null;
      if (gap) {
        invoicedTotal += lineInvoiced;
        catalogTotal += lineCatalog ?? 0;
      }
      return {
        "N° ligne": line.line_number,
        "Référence fournisseur": line.supplier_reference ?? "",
        "Libellé facture": line.label,
        Quantité: line.quantity,
        Unité: line.unit ?? "",
        "PU facturé": line.unit_price ?? "",
        "Remise %": line.discount_percent ?? "",
        "Total ligne facturé": line.line_total ?? lineInvoiced,
        "Coef. conditionnement": k,
        "Qté ramenée à l'unité": line.quantity * k,
        "PU comparable": gap ? gap.comparablePrice : (line.unit_price ?? ""),
        "Référence catalogue": line.catalog_products?.reference ?? "",
        "Libellé catalogue": line.catalog_products?.label ?? "",
        "EAN catalogue": line.catalog_products?.ean ?? "",
        "Famille catalogue": line.catalog_products?.family ?? "",
        "Unité catalogue": line.catalog_products?.unit ?? "",
        "PU catalogue": catalogPrice ?? "",
        "Total au tarif catalogue": lineCatalog ?? "",
        "Écart unitaire": gap ? gap.unitGap : "",
        "Écart total": gap ? gap.totalGap : "",
        "Écart %": gap?.percentGap ?? "",
        "Hors tolérance": gap ? (Math.abs(gap.percentGap ?? 0) > tolerance ? "oui" : "non") : "",
        Rapprochement: line.catalog_products ? (line.match_status ?? "") : "non rapproché",
        Méthode: line.manual_override ? "manuel" : (line.match_method ?? ""),
        "Score de rapprochement": line.match_score ?? "",
        "Validé manuellement": line.manual_override ? "oui" : "non",
        Devise: line.catalog_products?.currency ?? invoice?.currency ?? "EUR",
      };
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.sheet_add_aoa(
      sheet,
      [
        [],
        ["Total facturé (lignes rapprochées)", invoicedTotal],
        ["Total au tarif catalogue", catalogTotal],
        ["Écart total facturé", totals.total],
        ["Lignes hors tolérance", totals.anomalies],
        ["Lignes non rapprochées", totals.unmatched],
        ["Nombre de lignes", lines.length],
      ],
      { origin: -1 },
    );
    sheet["!cols"] = Object.keys(rows[0]!).map((key) => ({ wch: Math.max(14, key.length + 2) }));

    const book = XLSX.utils.book_new();

    const header = XLSX.utils.aoa_to_sheet([
      ["Facture", invoice?.invoice_number ?? ""],
      ["Fournisseur", invoice?.supplier_name ?? ""],
      ["Date", invoice?.invoice_date ?? ""],
      ["Fichier", invoice?.file_name ?? ""],
      ["Devise", invoice?.currency ?? "EUR"],
      ["Total HT facture", invoice?.total_ht ?? ""],
      ["Total TTC facture", invoice?.total_ttc ?? ""],
      ["Statut", invoice?.status ?? ""],
      ["Tolérance (%)", tolerance],
      [],
      ["Total facturé (lignes rapprochées)", invoicedTotal],
      ["Total au tarif catalogue", catalogTotal],
      ["Écart global", invoicedTotal - catalogTotal],
      [
        "Écart global %",
        catalogTotal > 0 ? ((invoicedTotal - catalogTotal) / catalogTotal) * 100 : "",
      ],
    ]);
    header["!cols"] = [{ wch: 36 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(book, header, "Facture");

    XLSX.utils.book_append_sheet(book, sheet, "Comparatif");
    const name = (invoice?.supplier_name || invoice?.file_name || "facture")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim();
    XLSX.writeFile(book, `comparatif-${name || "facture"}.xlsx`);
  }

  async function exportOzegoExcel() {
    if (lines.length === 0) {
      toast.error("Aucune ligne à exporter");
      return;
    }
    const XLSX = await import("xlsx");

    let invoicedTotal = 0;
    let bestTotal = 0;

    const rows = lines.map((line) => {
      const ozegoId = line.catalog_products?.ozego_id ?? null;
      const best = ozegoId ? bestByOzego.get(ozegoId) : undefined;
      const gap = ozegoGap(line, best);
      const k = gap?.packFactor ?? normalizePackFactor(line.pack_factor);
      const lineInvoiced = (line.unit_price ?? 0) * line.quantity;
      const lineBest = gap ? (best?.price ?? 0) * line.quantity * k : null;
      if (gap) {
        invoicedTotal += lineInvoiced;
        bestTotal += lineBest ?? 0;
      }
      return {
        "N° ligne": line.line_number,
        "Référence fournisseur": line.supplier_reference ?? "",
        "Libellé facture": line.label,
        Quantité: line.quantity,
        Unité: line.unit ?? "",
        "PU facturé": line.unit_price ?? "",
        "Remise %": line.discount_percent ?? "",
        "Total ligne facturé": line.line_total ?? lineInvoiced,
        "Coef. conditionnement": k,
        "Qté ramenée à l'unité": line.quantity * k,
        "PU comparable": gap ? gap.comparablePrice : (line.unit_price ?? ""),
        "Identifiant Ozego": ozegoId ?? "",
        "Références du groupe": best?.variants_count ?? "",
        "Référence la moins chère": best?.reference ?? "",
        "Identifiant Ozego de l'offre": best?.ozego_id ?? "",
        "Libellé Ozego": best?.label ?? "",
        "Fournisseur le moins cher": best?.supplier_name ?? "",
        EAN: best?.ean ?? "",
        Famille: best?.family ?? "",
        "Unité Ozego": best?.unit ?? "",
        "Meilleur PU Ozego": best?.price ?? "",
        "Total au meilleur prix": lineBest ?? "",
        "Écart unitaire": gap ? gap.unitGap : "",
        "Écart total": gap ? gap.totalGap : "",
        "Écart %": gap?.percentGap ?? "",
        "Hors tolérance": gap ? (Math.abs(gap.percentGap ?? 0) > tolerance ? "oui" : "non") : "",
        Rapprochement: line.catalog_products ? (line.match_status ?? "") : "non rapproché",
        "Validé manuellement": line.manual_override ? "oui" : "non",
        Devise: line.catalog_products?.currency ?? invoice?.currency ?? "EUR",
      };
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.sheet_add_aoa(
      sheet,
      [
        [],
        ["Total facturé (lignes rapprochées)", invoicedTotal],
        ["Total au meilleur prix Ozego", bestTotal],
        ["Écart total", ozegoTotals.total],
        ["Lignes hors tolérance", ozegoTotals.anomalies],
        ["Lignes sans identifiant Ozego", ozegoTotals.unmatched],
        ["Nombre de lignes", lines.length],
      ],
      { origin: -1 },
    );
    sheet["!cols"] = Object.keys(rows[0]!).map((key) => ({ wch: Math.max(14, key.length + 2) }));

    const book = XLSX.utils.book_new();
    const header = XLSX.utils.aoa_to_sheet([
      ["Facture", invoice?.invoice_number ?? ""],
      ["Fournisseur", invoice?.supplier_name ?? ""],
      ["Date", invoice?.invoice_date ?? ""],
      ["Fichier", invoice?.file_name ?? ""],
      ["Devise", invoice?.currency ?? "EUR"],
      ["Total HT facture", invoice?.total_ht ?? ""],
      ["Total TTC facture", invoice?.total_ttc ?? ""],
      ["Statut", invoice?.status ?? ""],
      ["Tolérance (%)", tolerance],
      [],
      ["Type de comparatif", "Identifiant Ozego (meilleur prix du groupe)"],
      ["Total facturé (lignes rapprochées)", invoicedTotal],
      ["Total au meilleur prix Ozego", bestTotal],
      ["Écart global", invoicedTotal - bestTotal],
      ["Écart global %", bestTotal > 0 ? ((invoicedTotal - bestTotal) / bestTotal) * 100 : ""],
    ]);
    header["!cols"] = [{ wch: 36 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(book, header, "Facture");
    XLSX.utils.book_append_sheet(book, sheet, "Comparatif Ozego");

    const name = (invoice?.supplier_name || invoice?.file_name || "facture")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim();
    XLSX.writeFile(book, `comparatif-ozego-${name || "facture"}.xlsx`);
  }

  async function exportRecapExcel() {
    if (lines.length === 0) {
      toast.error("Aucune ligne à exporter");
      return;
    }
    const XLSX = await import("xlsx");

    const rows = lines.map((line) => {
      const catalogPrice = line.catalog_products?.price ?? null;
      const sup = lineGap(line.unit_price, catalogPrice, line.quantity, line.pack_factor);
      const ozegoId = line.catalog_products?.ozego_id ?? null;
      const best = ozegoId ? bestByOzego.get(ozegoId) : undefined;
      const oz = ozegoGap(line, best);
      const k = sup?.packFactor ?? normalizePackFactor(line.pack_factor);
      return {
        "N° ligne": line.line_number,
        "Référence fournisseur": line.supplier_reference ?? "",
        "Libellé facture": line.label,
        Quantité: line.quantity,
        Unité: line.unit ?? "",
        "PU facturé": line.unit_price ?? "",
        "Coef. conditionnement": k,
        "PU comparable": sup ? sup.comparablePrice : (line.unit_price ?? ""),
        "Total ligne facturé": line.line_total ?? (line.unit_price ?? 0) * line.quantity,
        "Référence catalogue": line.catalog_products?.reference ?? "",
        "Libellé catalogue": line.catalog_products?.label ?? "",
        "PU catalogue": catalogPrice ?? "",
        "Écart fournisseur unitaire": sup ? sup.unitGap : "",
        "Écart fournisseur total": sup ? sup.totalGap : "",
        "Écart fournisseur %": sup?.percentGap ?? "",
        "Identifiant Ozego": ozegoId ?? "",
        "Références du groupe": best?.variants_count ?? "",
        "Référence la moins chère": best?.reference ?? "",
        "Identifiant Ozego de l'offre": best?.ozego_id ?? "",
        "Fournisseur le moins cher": best?.supplier_name ?? "",
        "Meilleur PU Ozego": best?.price ?? "",
        "Écart Ozego unitaire": oz ? oz.unitGap : "",
        "Écart Ozego total": oz ? oz.totalGap : "",
        "Écart Ozego %": oz?.percentGap ?? "",
        Rapprochement: line.catalog_products ? (line.match_status ?? "") : "non rapproché",
        Devise: line.catalog_products?.currency ?? invoice?.currency ?? "EUR",
      };
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.sheet_add_aoa(
      sheet,
      [
        [],
        ["Écart total référence fournisseur", totals.total],
        ["Écart total identifiant Ozego", ozegoTotals.total],
        ["Lignes hors tolérance (fournisseur)", totals.anomalies],
        ["Lignes hors tolérance (Ozego)", ozegoTotals.anomalies],
        ["Nombre de lignes", lines.length],
      ],
      { origin: -1 },
    );
    sheet["!cols"] = Object.keys(rows[0]!).map((key) => ({ wch: Math.max(14, key.length + 2) }));

    const book = XLSX.utils.book_new();
    const header = XLSX.utils.aoa_to_sheet([
      ["Facture", invoice?.invoice_number ?? ""],
      ["Fournisseur", invoice?.supplier_name ?? ""],
      ["Date", invoice?.invoice_date ?? ""],
      ["Devise", invoice?.currency ?? "EUR"],
      ["Total HT facture", invoice?.total_ht ?? ""],
      ["Tolérance (%)", tolerance],
      [],
      ["Type de comparatif", "Récapitulatif (fournisseur + Ozego)"],
    ]);
    header["!cols"] = [{ wch: 36 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(book, header, "Facture");
    XLSX.utils.book_append_sheet(book, sheet, "Récapitulatif");

    const name = (invoice?.supplier_name || invoice?.file_name || "facture")
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim();
    XLSX.writeFile(book, `recapitulatif-${name || "facture"}.xlsx`);
  }

  return (
    <AppShell expertOnly>
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/">Comparatifs</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {invoiceQuery.isPending || prospectId ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                {prospectId ? (
                  <BreadcrumbLink asChild>
                    <Link
                      to="/comparatifs/$id"
                      params={{ id: prospectId }}
                      search={backToComparatifSearch(historyState)}
                    >
                      <CrumbText
                        text={prospectQuery.data?.name || "Comparatif"}
                        loading={prospectQuery.isPending}
                      />
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <CrumbText text={null} loading />
                )}
              </BreadcrumbItem>
            </>
          ) : null}
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage>
              <CrumbText
                text={invoice?.supplier_name || invoice?.file_name || "Facture"}
                loading={invoiceQuery.isPending}
              />
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            {invoice?.supplier_name || invoice?.file_name || "Facture"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {invoice?.invoice_number ? `N° ${invoice.invoice_number} · ` : ""}
            {shortDate(invoice?.invoice_date)} · Total HT {euro(invoice?.total_ht)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void viewInvoiceFile(invoice?.file_path)}>
            <FileText className="size-4" />
            Voir le fichier original
          </Button>
          {mode === "ozego" || mode === "recap" || mode === "fournisseur" ? (
            <Button
              variant="outline"
              onClick={() =>
                void (mode === "ozego"
                  ? exportOzegoExcel()
                  : mode === "recap"
                    ? exportRecapExcel()
                    : exportExcel())
              }
            >
              <Download className="size-4" />
              {mode === "ozego"
                ? "Exporter le comparatif Ozego"
                : mode === "recap"
                  ? "Exporter le récapitulatif"
                  : "Exporter le comparatif fournisseur"}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={relaunch.isPending}
            onClick={() => relaunch.mutate()}
          >
            {relaunch.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Relancer le rapprochement
          </Button>
        </div>
      </div>

      <SectionTabs
        tabs={modeTabs}
        value={mode}
        onValueChange={(next) => updateSearch({ mode: next }, false)}
        label="Modes de comparaison de la facture"
        listClassName="mb-6"
      >
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(event) => onSearchText(event.target.value)}
              placeholder="Rechercher par référence, libellé…"
              className="pl-8"
            />
          </div>
          <NextToReviewButton onClick={goNext} />
          <Select
            value={statusFilter}
            onValueChange={(value) => updateSearch({ statut: value as StatusFilter }, true)}
          >
            <SelectTrigger className="w-48" aria-label="Filtrer par statut de rapprochement">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les lignes</SelectItem>
              <SelectItem value="validated">Lignes validées</SelectItem>
              <SelectItem value="unvalidated">Lignes non validées</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <SectionTabPanel value={mode}>
          <div {...trackingProps}>
            {mode === "recap" ? (
              <>
                <div className="mb-6 grid gap-4 sm:grid-cols-4">
                  <StatCard
                    label="Écart réf. fournisseur"
                    value={euro(totals.total)}
                    tone={totals.total > 0 ? "bad" : "good"}
                  />
                  <StatCard
                    label="Écart identifiant Ozego"
                    value={euro(ozegoTotals.total)}
                    tone={ozegoTotals.total > 0 ? "bad" : "good"}
                  />
                  <StatCard
                    label="Lignes rapprochées"
                    value={`${lines.length - totals.unmatched}/${lines.length}`}
                    tone={totals.unmatched ? "warn" : "good"}
                  />
                  <StatCard
                    label="Lignes hors tolérance"
                    value={String(Math.max(totals.anomalies, ozegoTotals.anomalies))}
                    tone={totals.anomalies || ozegoTotals.anomalies ? "warn" : "good"}
                  />
                </div>

                <DataTableCard
                  title="Récapitulatif ligne par ligne"
                  busy={linesQuery.isLoading}
                  below={
                    !linesQuery.isLoading && visibleLines.length === 0 ? (
                      <TableMessage>
                        {lines.length === 0
                          ? "Aucune ligne extraite pour cette facture."
                          : "Aucune ligne ne correspond aux filtres."}
                      </TableMessage>
                    ) : null
                  }
                >
                  <table className="w-full text-sm">
                    <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Désignation fournisseur</th>
                        <th className="px-4 py-3 text-right font-medium">Qté</th>
                        <th className="px-4 py-3 text-right font-medium">PU facturé</th>
                        <th className="px-4 py-3 text-right font-medium">PU comparable</th>
                        <th className="px-4 py-3 font-medium">Réf. catalogue</th>
                        <th className="px-4 py-3 text-right font-medium">PU catalogue</th>
                        <th className="px-4 py-3 text-right font-medium">Écart fournisseur</th>
                        <th className="px-4 py-3 font-medium">Meilleure offre Ozego</th>
                        <th className="px-4 py-3 text-right font-medium">Meilleur PU</th>
                        <th className="px-4 py-3 text-right font-medium">Écart Ozego</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {linesQuery.isLoading ? <TableSkeletonRows columns={10} /> : null}
                      {visibleLines.map((line) => {
                        const catalogPrice = line.catalog_products?.price ?? null;
                        const sup = lineGap(
                          line.unit_price,
                          catalogPrice,
                          line.quantity,
                          line.pack_factor,
                        );
                        const ozegoId = line.catalog_products?.ozego_id ?? null;
                        const best = ozegoId ? bestByOzego.get(ozegoId) : undefined;
                        const oz = ozegoGap(line, best);
                        const out =
                          (sup && Math.abs(sup.percentGap ?? 0) > tolerance) ||
                          (oz && Math.abs(oz.percentGap ?? 0) > tolerance);
                        return (
                          <tr
                            key={line.id}
                            data-line-id={line.id}
                            className={
                              highlightedId === line.id
                                ? HIGHLIGHT_ROW_CLASS
                                : out
                                  ? "bg-destructive/5"
                                  : undefined
                            }
                          >
                            <td className="px-4 py-3">
                              <span className="block font-medium">{line.label}</span>
                              <span className="block font-mono text-xs text-muted-foreground">
                                {line.supplier_reference || "sans référence"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {line.quantity}
                              {line.unit ? (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  {line.unit}
                                </span>
                              ) : null}
                              {normalizePackFactor(line.pack_factor) !== 1 ? (
                                <span className="block text-xs text-muted-foreground">
                                  cond. ×{normalizePackFactor(line.pack_factor)}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {euro(line.unit_price)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {euro(comparableUnitPrice(line.unit_price, line.pack_factor))}
                            </td>
                            <td className="px-4 py-3">
                              {line.catalog_products ? (
                                <>
                                  <span className="block">{line.catalog_products.label}</span>
                                  <span className="block font-mono text-xs text-muted-foreground">
                                    {line.catalog_products.reference}
                                  </span>
                                </>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className="bg-warning/20 text-warning-foreground"
                                >
                                  À rapprocher
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                              {euro(catalogPrice)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-medium tabular-nums ${
                                !sup
                                  ? "text-muted-foreground"
                                  : sup.unitGap > 0
                                    ? "text-destructive"
                                    : sup.unitGap < 0
                                      ? "text-success"
                                      : ""
                              }`}
                            >
                              {sup ? (
                                <>
                                  <span className="block">{euro(sup.totalGap)}</span>
                                  <span className="block text-xs">{percent(sup.percentGap)}</span>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {best ? (
                                <>
                                  <span className="block">{best.supplier_name ?? "—"}</span>
                                  <span className="block font-mono text-xs text-muted-foreground">
                                    {best.reference} · {ozegoId}
                                  </span>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {ozegoId ? "Aucune variante" : "Sans identifiant Ozego"}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                              {euro(best?.price ?? null)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-medium tabular-nums ${
                                !oz
                                  ? "text-muted-foreground"
                                  : oz.unitGap > 0
                                    ? "text-destructive"
                                    : oz.unitGap < 0
                                      ? "text-success"
                                      : ""
                              }`}
                            >
                              {oz ? (
                                <>
                                  <span className="block">{euro(oz.totalGap)}</span>
                                  <span className="block text-xs">{percent(oz.percentGap)}</span>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-border bg-muted/60 font-medium">
                      <tr>
                        <td className="px-4 py-3" colSpan={4}>
                          Total
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{euro(invoicedTotal)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {euro(catalogTotal)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right tabular-nums ${totals.total > 0 ? "text-destructive" : totals.total < 0 ? "text-success" : ""}`}
                        >
                          {euro(totals.total)}
                        </td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {euro(bestTotal)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right tabular-nums ${ozegoTotals.total > 0 ? "text-destructive" : ozegoTotals.total < 0 ? "text-success" : ""}`}
                        >
                          {euro(ozegoTotals.total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </DataTableCard>
              </>
            ) : mode === "achat" ? (
              <>
                <div className="mb-6 grid gap-4 sm:grid-cols-2">
                  <StatCard label="Total facturé" value={euro(invoicedTotal)} tone="good" />
                  <StatCard label="Lignes" value={String(lines.length)} tone="good" />
                </div>

                <DataTableCard
                  title="Achat client"
                  busy={linesQuery.isLoading}
                  below={
                    !linesQuery.isLoading && visibleLines.length === 0 ? (
                      <TableMessage>
                        {lines.length === 0
                          ? "Aucune ligne extraite pour cette facture."
                          : "Aucune ligne ne correspond aux filtres."}
                      </TableMessage>
                    ) : null
                  }
                >
                  <table className="w-full text-sm">
                    <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Désignation fournisseur</th>
                        <th className="px-4 py-3 text-right font-medium">Qté</th>
                        <th className="px-4 py-3 font-medium">Unité</th>
                        <th className="px-4 py-3 text-right font-medium">PU facturé</th>
                        <th className="px-4 py-3 text-right font-medium">Remise %</th>
                        <th className="px-4 py-3 text-right font-medium">Total ligne</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {linesQuery.isLoading ? <TableSkeletonRows columns={6} /> : null}
                      {visibleLines.map((line) => (
                        <tr
                          key={line.id}
                          data-line-id={line.id}
                          className={highlightedId === line.id ? HIGHLIGHT_ROW_CLASS : undefined}
                        >
                          <td className="px-4 py-3">
                            <span className="block font-medium">{line.label}</span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {line.supplier_reference || "sans référence"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {line.quantity}
                            {normalizePackFactor(line.pack_factor) !== 1 ? (
                              <span className="block text-xs text-muted-foreground">
                                cond. ×{normalizePackFactor(line.pack_factor)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">{line.unit || "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {euro(line.unit_price)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {line.discount_percent ? percent(line.discount_percent) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums">
                            {euro(line.line_total ?? (line.unit_price ?? 0) * line.quantity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-border bg-muted/60 font-medium">
                      <tr>
                        <td className="px-4 py-3" colSpan={5}>
                          Total
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{euro(invoicedTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </DataTableCard>
              </>
            ) : mode === "ozego" ? (
              <OzegoComparisonTable
                lines={visibleLines}
                allLinesCount={lines.length}
                {...ozegoTableLabels("ozego", preferredSuppliers.length)}
                rowFor={(line) => bestRowFor(line, bestByOzego)}
                totals={{ ...ozegoTotals, bestTotal }}
                invoicedTotal={invoicedTotal}
                tolerance={tolerance}
                onSaveLineField={(line, patch) => void saveLineField(line, patch)}
                onSavePackFactor={(line, value) => void savePackFactor(line, value)}
                onPick={setPicking}
                onUnmatch={(line) => void applyMatch(line, null, "ozego")}
                onDelete={(line) => void deleteLine(line)}
                stage="ozego"
                isLoading={linesQuery.isLoading}
                ozegoLoading={ozegoLoading}
                highlightedId={highlightedId}
              />
            ) : mode === "ozego-preferes" ? (
              <OzegoComparisonTable
                lines={visibleLines}
                allLinesCount={lines.length}
                {...ozegoTableLabels("ozego-preferes", preferredSuppliers.length)}
                rowFor={preferredRowFor}
                totals={preferredTotals}
                invoicedTotal={invoicedTotal}
                tolerance={tolerance}
                onSaveLineField={(line, patch) => void saveLineField(line, patch)}
                onSavePackFactor={(line, value) => void savePackFactor(line, value)}
                onPick={setPicking}
                onUnmatch={(line) => void applyMatch(line, null, "ozego-preferes")}
                onDelete={(line) => void deleteLine(line)}
                stage="ozego-preferes"
                isLoading={linesQuery.isLoading}
                ozegoLoading={ozegoLoading}
                highlightedId={highlightedId}
              />
            ) : (
              <>
                <FournisseurComparisonTable
                  lines={visibleLines}
                  allLinesCount={lines.length}
                  isLoading={linesQuery.isLoading}
                  totals={totals}
                  invoicedTotal={invoicedTotal}
                  catalogTotal={catalogTotal}
                  tolerance={tolerance}
                  onSaveLineField={(line, patch) => void saveLineField(line, patch)}
                  onSavePackFactor={(line, value) => void savePackFactor(line, value)}
                  onPick={setPicking}
                  onConfirm={(line) => void confirm(line)}
                  onUnmatch={(line) => void applyMatch(line, null, "fournisseur")}
                  onDelete={(line) => void deleteLine(line)}
                  highlightedId={highlightedId}
                  selection={bulk.selection}
                  toolbar={
                    <BulkToolbar
                      threshold={bulk.threshold}
                      onThresholdChange={bulk.setThreshold}
                      onSelectAboveScore={bulk.selectAboveScore}
                      filteredCount={bulk.eligibleCount}
                      selectedCount={bulk.selectedCount}
                      onSelectAllFiltered={bulk.selectAllFiltered}
                      disabled={bulk.progress !== null}
                    />
                  }
                />
                {bulk.report ? (
                  <BulkResult
                    summary={bulk.report.summary}
                    failures={bulk.report.failures}
                    onDismiss={bulk.dismissReport}
                  />
                ) : null}
                <BulkActionBar
                  count={bulk.selectedCount}
                  progress={bulk.progress}
                  onValidate={bulk.requestValidate}
                  onClear={bulk.clear}
                />
              </>
            )}
          </div>
        </SectionTabPanel>
      </SectionTabs>

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
          initialSearch={picking.supplier_reference || picking.label}
          onPick={(product) => void applyMatch(picking, product, mode as Stage)}
        />
      ) : null}
    </AppShell>
  );
}
