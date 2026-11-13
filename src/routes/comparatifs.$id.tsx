import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Check, Download, FileUp, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { CrumbText } from "@/components/CrumbText";
import { ListRowsSkeleton } from "@/components/LoadingSkeletons";
import { ProspectMatchingView } from "@/components/ProspectMatchingView";
import { ProspectStepper } from "@/components/ProspectStepper";
import { SectionTabPanel, SectionTabs, type SectionTabItem } from "@/components/SectionTabs";
import { SupplierMultiSelect } from "@/components/SupplierMultiSelect";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PROSPECT_STATUSES, statusMeta } from "@/lib/prospect-status";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { processInvoice } from "@/lib/invoices.functions";
import { deleteInvoiceMessage } from "@/lib/delete-messages";
import { euro, gapPercentLabel, gapTextClass, lineGap, shortDate } from "@/lib/format";
import { formatPriceColumns, formatPriceRows, rowOf } from "@/lib/xlsx-format";
import { friendlyError } from "@/lib/errors";
import { toastError } from "@/lib/toast-error";
import { applyPatch, revertPatch } from "@/lib/optimistic-patch";
import { normalizePackFactor } from "@/lib/pack";
import { fetchAllRows, type RangeQuery } from "@/lib/paginate";
import { countToReview } from "@/lib/review-navigation";
import { cheapestAmong, ozegoGap } from "@/lib/ozego";
import { prospectQueryOptions } from "@/lib/prospect-query";
import {
  parseComparatifSearch,
  patchComparatifSearch,
  serializeComparatifSearch,
  validateComparatifSearch,
  withVue,
  type ComparatifSearch,
  type Vue,
} from "@/lib/search-params";
import { stepperState, summarizeLines, type StepId } from "@/lib/stepper";
import { useOzegoComparison } from "@/lib/use-ozego-comparison";
import { invalidateLineCaches } from "@/lib/use-line-actions";
import { useSavedIndicator } from "@/lib/use-saved-indicator";

export const Route = createFileRoute("/comparatifs/$id")({
  head: () => ({
    meta: [
      { title: "Comparatif prospect — comparateur test Ozego" },
      {
        name: "description",
        content:
          "Importez les factures fournisseurs d'un prospect et suivez l'analyse ligne par ligne.",
      },
      { property: "og:title", content: "Comparatif prospect — comparateur test Ozego" },
      {
        property: "og:description",
        content: "Factures du prospect, extraction automatique et comparatif de prix.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: validateComparatifSearch,
  component: ProspectComparison,
});

const VUE_TABS = (toReviewCount: number | null): ReadonlyArray<SectionTabItem<Vue>> => [
  { id: "synthese", label: "Synthèse" },
  {
    id: "rapprochements",
    label: "Tous les rapprochements",
    count: toReviewCount,
    countTitle: `${toReviewCount ?? 0} ligne(s) à vérifier`,
  },
];

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: { label: "En attente", className: "bg-muted text-muted-foreground" },
  processing: { label: "Analyse en cours", className: "bg-warning/20 text-warning-foreground" },
  processed: { label: "Analysée", className: "bg-success/15 text-success" },
  error: { label: "Erreur", className: "bg-destructive/10 text-destructive" },
};

type AnalysisLine = {
  id: string;
  line_number: number;
  supplier_reference: string | null;
  label: string;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  discount_percent: number | null;
  line_total: number | null;
  pack_factor: number | null;
  match_status: string | null;
  match_score: number | null;
  match_method: string | null;
  manual_override: boolean | null;
  matched_product_id: string | null;
  invoices: {
    id: string;
    supplier_name: string | null;
    file_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    currency: string | null;
  } | null;
  catalog_products: {
    reference: string;
    label: string;
    price: number | null;
    unit: string | null;
    ean: string | null;
    family: string | null;
    ozego_id: string | null;
    supplier_name: string | null;
  } | null;
};

type ProspectPatch = {
  status?: string;
  delivery_date?: string | null;
  preferred_suppliers?: string[];
  matching_suppliers?: string[];
};

function ProspectComparison() {
  const { id } = Route.useParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const importZoneRef = useRef<HTMLLabelElement>(null);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const process = useServerFn(processInvoice);
  const { isExpert } = useAuth();
  const navigate = Route.useNavigate();
  const rawSearch = Route.useSearch();
  const search = useMemo(() => parseComparatifSearch(rawSearch), [rawSearch]);

  /** Onglet : entrée d'historique (replace false). Filtre ou page : replace true. */
  const updateSearch = useCallback(
    (
      change: Partial<ComparatifSearch> | ((current: ComparatifSearch) => ComparatifSearch),
      replace: boolean,
    ) => {
      void navigate({
        search: (prev) =>
          typeof change === "function"
            ? serializeComparatifSearch(change(parseComparatifSearch(prev)))
            : patchComparatifSearch(prev, change),
        replace,
        resetScroll: false,
      });
    },
    [navigate],
  );
  const [invoiceToDelete, setInvoiceToDelete] = useState<{
    id: string;
    path: string | null;
    name: string;
    lineCount: number;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const prospectQuery = useQuery(prospectQueryOptions(id));

  const saved = useSavedIndicator();
  const prospectMutationKey = ["prospect-update", id];
  /**
   * Écriture optimiste de l'en-tête : le cache `["prospect", id]` change tout de suite (pas de retour
   * bref à l'ancienne valeur), l'écriture refusée remet seulement les champs du patch.
   */
  const updateProspectMutation = useMutation({
    mutationKey: prospectMutationKey,
    mutationFn: async (patch: ProspectPatch) => {
      const { error } = await supabase.from("prospects").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ["prospect", id] });
      const previous = queryClient.getQueryData<Tables<"prospects">>(["prospect", id]);
      queryClient.setQueryData<Tables<"prospects">>(["prospect", id], (current) =>
        applyPatch(current, patch),
      );
      return { previous };
    },
    onError: (error, patch, context) => {
      queryClient.setQueryData<Tables<"prospects">>(["prospect", id], (current) =>
        revertPatch(current, context?.previous, patch),
      );
      saved.hide();
      toastError(error);
    },
    onSuccess: () => saved.flash(),
    onSettled: () => {
      // Pas de relecture tant qu'une autre écriture est en cours : elle ferait revenir la valeur.
      if (queryClient.isMutating({ mutationKey: prospectMutationKey }) > 1) return;
      void queryClient.invalidateQueries({ queryKey: ["prospect", id] });
      void queryClient.invalidateQueries({ queryKey: ["prospects"] });
    },
  });
  const updateProspect = (patch: ProspectPatch) => updateProspectMutation.mutate(patch);

  const invoicesQuery = useQuery({
    queryKey: ["invoices", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, invoice_lines(count)")
        .eq("prospect_id", id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    enabled: isExpert,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("tolerance_percent")
        .maybeSingle();
      return data;
    },
  });

  const analysisQuery = useQuery({
    queryKey: ["prospect-lines", id],
    enabled: isExpert,
    queryFn: () =>
      fetchAllRows<AnalysisLine>(
        () =>
          supabase
            .from("invoice_lines")
            .select(
              "id, line_number, supplier_reference, label, quantity, unit, unit_price, discount_percent, line_total, pack_factor, match_status, match_score, match_method, manual_override, matched_product_id, invoices!inner(id, supplier_name, file_name, invoice_number, invoice_date, currency, prospect_id), catalog_products(reference, label, price, unit, ean, family, ozego_id, supplier_name)",
            )
            .eq("invoices.prospect_id", id)
            .eq("excluded", false)
            .order("id") as unknown as RangeQuery<AnalysisLine>,
      ),
  });

  const analyse = useMutation({
    mutationFn: (invoiceId: string) => process({ data: { invoiceId } }),
    onSuccess: () => toast.success("Facture analysée"),
    onError: (error: Error) => toastError(error),
    onSettled: (_data, _error, invoiceId) =>
      invalidateLineCaches(queryClient, { invoiceId, prospectId: id }, { ozego: false }),
  });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const upload = await supabase.storage.from("invoices").upload(path, file, {
          contentType: file.type || "application/pdf",
        });
        if (upload.error) throw new Error(upload.error.message);

        const { data: invoice, error } = await supabase
          .from("invoices")
          .insert({
            prospect_id: id,
            file_path: path,
            file_name: file.name,
            file_mime: file.type || "application/pdf",
            status: "processing",
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);

        invalidateLineCaches(
          queryClient,
          { invoiceId: invoice.id, prospectId: id },
          { ozego: false },
        );
        analyse.mutate(invoice.id);
      }
    } catch (error) {
      toastError(error, "Échec du téléversement");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(invoiceId: string, path: string | null) {
    if (path) await supabase.storage.from("invoices").remove([path]);
    const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
    if (error) {
      toastError(error);
      return;
    }
    invalidateLineCaches(queryClient, { invoiceId, prospectId: id }, { ozego: false });
    router.invalidate();
    toast.success("Facture supprimée");
  }

  async function viewInvoiceFile(path: string | null) {
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

  const invoices = invoicesQuery.data ?? [];
  const tolerance = settingsQuery.data?.tolerance_percent ?? 2;

  const analysisLines = analysisQuery.data ?? [];
  // Les lignes du comparatif sont déjà chargées pour la synthèse : aucune requête de plus.
  const toReviewCount = analysisQuery.data ? countToReview(analysisQuery.data) : null;

  const ozegoIds = analysisLines
    .map((line) => line.catalog_products?.ozego_id ?? null)
    .filter((value): value is string => Boolean(value));

  const { bestByOzego, variantsByOzego } = useOzegoComparison(ozegoIds, isExpert);
  const preferredSuppliers = prospectQuery.data?.preferred_suppliers ?? [];

  const analysis = (() => {
    let invoiced = 0;
    let catalog = 0;
    let matched = 0;
    let unmatched = 0;
    let above = 0;
    let below = 0;
    const bySupplier = new Map<
      string,
      { invoiced: number; catalog: number; gap: number; lines: number }
    >();
    const details: Array<{
      id: string;
      label: string;
      supplier: string;
      gap: number;
      percentGap: number | null;
    }> = [];

    for (const line of analysisLines) {
      const supplier =
        line.invoices?.supplier_name || line.invoices?.file_name || "Fournisseur inconnu";
      const gap = lineGap(
        line.unit_price,
        line.catalog_products?.price ?? null,
        line.quantity,
        line.pack_factor,
      );
      if (!gap) {
        unmatched += 1;
        continue;
      }
      matched += 1;
      const k = gap.packFactor;
      const lineInvoiced = (line.unit_price ?? 0) * line.quantity;
      const lineCatalog = (line.catalog_products?.price ?? 0) * line.quantity * k;
      invoiced += lineInvoiced;
      catalog += lineCatalog;
      if (gap.percentGap !== null && Math.abs(gap.percentGap) > tolerance) {
        if (gap.totalGap > 0) above += 1;
        else below += 1;
      }
      const entry = bySupplier.get(supplier) ?? { invoiced: 0, catalog: 0, gap: 0, lines: 0 };
      entry.invoiced += lineInvoiced;
      entry.catalog += lineCatalog;
      entry.gap += gap.totalGap;
      entry.lines += 1;
      bySupplier.set(supplier, entry);
      details.push({
        id: line.id,
        label: line.label,
        supplier,
        gap: gap.totalGap,
        percentGap: gap.percentGap,
      });
    }

    const saving = invoiced - catalog;
    return {
      invoiced,
      catalog,
      saving,
      savingPercent: invoiced === 0 ? null : (saving / invoiced) * 100,
      matched,
      unmatched,
      above,
      below,
      suppliers: [...bySupplier.entries()].sort((a, b) => b[1].gap - a[1].gap),
      top: [...details].sort((a, b) => b.gap - a.gap).slice(0, 5),
      worst: [...details].sort((a, b) => a.gap - b.gap).slice(0, 5),
    };
  })();

  const ozegoAnalysis = (() => {
    let invoiced = 0;
    let best = 0;
    let preferredTotal = 0;
    let preferredCount = 0;
    let matched = 0;
    let unmatched = 0;
    let above = 0;
    const bySupplier = new Map<
      string,
      { invoiced: number; best: number; gap: number; lines: number }
    >();

    for (const line of analysisLines) {
      const supplier =
        line.invoices?.supplier_name || line.invoices?.file_name || "Fournisseur inconnu";
      const ozegoId = line.catalog_products?.ozego_id ?? null;
      const variants = ozegoId ? variantsByOzego.get(ozegoId) : undefined;
      const bestRow = ozegoId ? bestByOzego.get(ozegoId) : undefined;
      const gap = ozegoGap(line, bestRow);
      if (!gap) {
        unmatched += 1;
        continue;
      }
      matched += 1;
      const lineInvoiced = (line.unit_price ?? 0) * line.quantity;
      const lineBest = (bestRow?.price ?? 0) * line.quantity * gap.packFactor;
      invoiced += lineInvoiced;
      best += lineBest;
      if (gap.percentGap !== null && Math.abs(gap.percentGap) > tolerance && gap.totalGap > 0)
        above += 1;
      const entry = bySupplier.get(supplier) ?? { invoiced: 0, best: 0, gap: 0, lines: 0 };
      entry.invoiced += lineInvoiced;
      entry.best += lineBest;
      entry.gap += gap.totalGap;
      entry.lines += 1;
      bySupplier.set(supplier, entry);

      // Cas 2 : même produit Ozego, moins cher parmi la liste de fournisseurs préférés.
      const preferredRow = cheapestAmong(variants, preferredSuppliers);
      if (preferredRow?.price != null) {
        preferredTotal += preferredRow.price * line.quantity * gap.packFactor;
        preferredCount += 1;
      }
    }

    const saving = invoiced - best;
    return {
      invoiced,
      best,
      saving,
      savingPercent: invoiced === 0 ? null : (saving / invoiced) * 100,
      matched,
      unmatched,
      above,
      suppliers: [...bySupplier.entries()].sort((a, b) => b[1].gap - a[1].gap),
      preferredTotal,
      preferredCount,
    };
  })();

  async function exportOzegoAnalysis() {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();

    const summary = XLSX.utils.aoa_to_sheet([
      ["Prospect", prospectQuery.data?.name ?? ""],
      ["Type de comparatif", "Identifiant Ozego (meilleur prix du groupe)"],
      ["Fournisseurs préférés", preferredSuppliers.join(", ") || "(aucun défini)"],
      ["Total facturé (lignes rapprochées)", ozegoAnalysis.invoiced],
      ["Total au meilleur prix Ozego (tous fournisseurs)", ozegoAnalysis.best],
      ["Écart global", ozegoAnalysis.saving],
      ["Écart global %", ozegoAnalysis.savingPercent ?? ""],
      [
        "Total au meilleur prix fournisseurs préférés",
        ozegoAnalysis.preferredTotal,
        `(${ozegoAnalysis.preferredCount} ligne(s))`,
      ],
      ["Lignes avec identifiant Ozego", ozegoAnalysis.matched],
      ["Lignes sans identifiant Ozego", ozegoAnalysis.unmatched],
      [`Lignes > tolérance (${tolerance} %)`, ozegoAnalysis.above],
      [],
      ["Fournisseur", "Lignes", "Facturé", "Meilleur prix Ozego", "Écart"],
      ...ozegoAnalysis.suppliers.map(([supplier, row]) => [
        supplier,
        row.lines,
        row.invoiced,
        row.best,
        row.gap,
      ]),
    ]);
    summary["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(
      book,
      formatPriceColumns(formatPriceRows(summary), rowOf(summary, "Fournisseur")),
      "Synthèse",
    );

    const rows = analysisLines.map((line) => {
      const supplier = line.invoices?.supplier_name || line.invoices?.file_name || "";
      const ozegoId = line.catalog_products?.ozego_id ?? null;
      const variants = ozegoId ? variantsByOzego.get(ozegoId) : undefined;
      const bestRow = ozegoId ? bestByOzego.get(ozegoId) : undefined;
      const preferredRow = cheapestAmong(variants, preferredSuppliers);
      const gap = ozegoGap(line, bestRow);
      const preferredGap = ozegoGap(line, preferredRow);
      const k = gap?.packFactor ?? normalizePackFactor(line.pack_factor);
      const lineInvoiced = line.line_total ?? (line.unit_price ?? 0) * line.quantity;
      const lineBest = gap ? (bestRow?.price ?? 0) * line.quantity * k : "";
      return {
        Fournisseur: supplier,
        "N° facture": line.invoices?.invoice_number ?? "",
        "Date facture": line.invoices?.invoice_date ?? "",
        Fichier: line.invoices?.file_name ?? "",
        "N° ligne": line.line_number,
        "Référence fournisseur": line.supplier_reference ?? "",
        "Libellé facture": line.label,
        Quantité: line.quantity,
        Unité: line.unit ?? "",
        "PU facturé": line.unit_price ?? "",
        "Remise %": line.discount_percent ?? "",
        "Total ligne facturé": lineInvoiced,
        "Coef. conditionnement": k,
        "Qté ramenée à l'unité": line.quantity * k,
        "PU comparable": gap ? gap.comparablePrice : "",
        "Identifiant Ozego": ozegoId ?? "",
        // Cas 1 : moins cher, tous fournisseurs confondus.
        "Références du groupe": bestRow?.variants_count ?? "",
        "[Tous fournisseurs] Référence": bestRow?.reference ?? "",
        "[Tous fournisseurs] Identifiant Ozego de l'offre": bestRow?.ozego_id ?? "",
        "[Tous fournisseurs] Libellé Ozego": bestRow?.label ?? "",
        "[Tous fournisseurs] Fournisseur": bestRow?.supplier_name ?? "",
        EAN: bestRow?.ean ?? "",
        Famille: bestRow?.family ?? "",
        "Unité Ozego": bestRow?.unit ?? "",
        "[Tous fournisseurs] PU Ozego": bestRow?.price ?? "",
        "[Tous fournisseurs] Total au meilleur prix": lineBest,
        "[Tous fournisseurs] Écart unitaire": gap ? gap.unitGap : "",
        "[Tous fournisseurs] Écart total": gap ? gap.totalGap : "",
        "[Tous fournisseurs] Écart %": gap?.percentGap ?? "",
        // Cas 2 : moins cher, restreint à la liste de fournisseurs préférés du prospect.
        "[Préférés] Fournisseur": preferredRow?.supplier_name ?? "",
        "[Préférés] Référence": preferredRow?.reference ?? "",
        "[Préférés] Identifiant Ozego de l'offre": preferredRow?.ozego_id ?? "",
        "[Préférés] PU Ozego": preferredRow?.price ?? "",
        "[Préférés] Écart %": preferredGap?.percentGap ?? "",
        "[Préférés] Écart total": preferredGap?.totalGap ?? "",
        "Hors tolérance": gap ? (Math.abs(gap.percentGap ?? 0) > tolerance ? "oui" : "non") : "",
        Rapprochement: line.catalog_products ? (line.match_status ?? "") : "non rapproché",
        "Validé manuellement": line.manual_override ? "oui" : "non",
        Devise: line.invoices?.currency ?? "EUR",
      };
    });
    const detail = XLSX.utils.json_to_sheet(rows);
    detail["!cols"] = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: Math.max(14, key.length + 2),
    }));
    XLSX.utils.book_append_sheet(book, formatPriceColumns(detail), "Détail");

    const invoiceRows = invoices.map((inv) => ({
      Fournisseur: inv.supplier_name ?? "",
      "N° facture": inv.invoice_number ?? "",
      Date: inv.invoice_date ?? "",
      Fichier: inv.file_name ?? "",
      Statut: inv.status,
      "Total HT": inv.total_ht ?? "",
      "Total TTC": inv.total_ttc ?? "",
      Devise: inv.currency ?? "EUR",
    }));
    if (invoiceRows.length > 0) {
      const invoicesSheet = XLSX.utils.json_to_sheet(invoiceRows);
      invoicesSheet["!cols"] = Object.keys(invoiceRows[0]!).map((key) => ({
        wch: Math.max(14, key.length + 2),
      }));
      XLSX.utils.book_append_sheet(book, formatPriceColumns(invoicesSheet), "Factures");
    }

    const name = (prospectQuery.data?.name ?? "prospect").replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    XLSX.writeFile(book, `analyse-ozego-${name || "prospect"}.xlsx`);
  }

  async function exportAnalysis() {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();

    const summary = XLSX.utils.aoa_to_sheet([
      ["Prospect", prospectQuery.data?.name ?? ""],
      ["Total facturé (lignes rapprochées)", analysis.invoiced],
      ["Total au tarif catalogue", analysis.catalog],
      ["Écart global", analysis.saving],
      ["Écart global %", analysis.savingPercent ?? ""],
      ["Lignes rapprochées", analysis.matched],
      ["Lignes non rapprochées", analysis.unmatched],
      [`Lignes > tolérance (${tolerance} %)`, analysis.above],
      ["Lignes déjà compétitives", analysis.below],
      [],
      ["Fournisseur", "Lignes", "Facturé", "Catalogue", "Écart"],
      ...analysis.suppliers.map(([supplier, row]) => [
        supplier,
        row.lines,
        row.invoiced,
        row.catalog,
        row.gap,
      ]),
    ]);
    summary["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(
      book,
      formatPriceColumns(formatPriceRows(summary), rowOf(summary, "Fournisseur")),
      "Synthèse",
    );

    const rows = analysisLines.map((line) => {
      const gap = lineGap(
        line.unit_price,
        line.catalog_products?.price ?? null,
        line.quantity,
        line.pack_factor,
      );
      const k = gap?.packFactor ?? normalizePackFactor(line.pack_factor);
      const lineInvoiced = line.line_total ?? (line.unit_price ?? 0) * line.quantity;
      const lineCatalog = gap ? (line.catalog_products?.price ?? 0) * line.quantity * k : "";
      return {
        Fournisseur: line.invoices?.supplier_name || line.invoices?.file_name || "",
        "N° facture": line.invoices?.invoice_number ?? "",
        "Date facture": line.invoices?.invoice_date ?? "",
        Fichier: line.invoices?.file_name ?? "",
        "N° ligne": line.line_number,
        "Référence fournisseur": line.supplier_reference ?? "",
        "Libellé facture": line.label,
        Quantité: line.quantity,
        Unité: line.unit ?? "",
        "PU facturé": line.unit_price ?? "",
        "Remise %": line.discount_percent ?? "",
        "Total ligne facturé": lineInvoiced,
        "Coef. conditionnement": k,
        "Qté ramenée à l'unité": line.quantity * k,
        "PU comparable": gap ? gap.comparablePrice : "",
        "Référence catalogue": line.catalog_products?.reference ?? "",
        "Libellé catalogue": line.catalog_products?.label ?? "",
        "EAN catalogue": line.catalog_products?.ean ?? "",
        "Famille catalogue": line.catalog_products?.family ?? "",
        "Unité catalogue": line.catalog_products?.unit ?? "",
        "PU catalogue": line.catalog_products?.price ?? "",
        "Total au tarif catalogue": lineCatalog,
        "Écart unitaire": gap ? gap.unitGap : "",
        "Écart total": gap ? gap.totalGap : "",
        "Écart %": gap?.percentGap ?? "",
        "Hors tolérance": gap ? (Math.abs(gap.percentGap ?? 0) > tolerance ? "oui" : "non") : "",
        Rapprochement: line.catalog_products ? (line.match_status ?? "") : "non rapproché",
        Méthode: line.manual_override ? "manuel" : (line.match_method ?? ""),
        "Score de rapprochement": line.match_score ?? "",
        Devise: line.invoices?.currency ?? "EUR",
      };
    });
    const detail = XLSX.utils.json_to_sheet(rows);
    detail["!cols"] = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: Math.max(14, key.length + 2),
    }));
    XLSX.utils.book_append_sheet(book, formatPriceColumns(detail), "Détail");

    const invoiceRows = invoices.map((inv) => ({
      Fournisseur: inv.supplier_name ?? "",
      "N° facture": inv.invoice_number ?? "",
      Date: inv.invoice_date ?? "",
      Fichier: inv.file_name ?? "",
      Statut: inv.status,
      "Total HT": inv.total_ht ?? "",
      "Total TTC": inv.total_ttc ?? "",
      Devise: inv.currency ?? "EUR",
    }));
    if (invoiceRows.length > 0) {
      const invoicesSheet = XLSX.utils.json_to_sheet(invoiceRows);
      invoicesSheet["!cols"] = Object.keys(invoiceRows[0]!).map((key) => ({
        wch: Math.max(14, key.length + 2),
      }));
      XLSX.utils.book_append_sheet(book, formatPriceColumns(invoicesSheet), "Factures");
    }

    const name = (prospectQuery.data?.name ?? "prospect").replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    XLSX.writeFile(book, `analyse-${name || "prospect"}.xlsx`);
  }

  const steps = stepperState({
    invoiceCount: invoices.length,
    ...summarizeLines(analysisLines),
    isExpert,
    comparerGap: analysis.matched > 0 ? analysis.saving : null,
  });
  const stepperLoading = invoicesQuery.isPending || (isExpert && analysisQuery.isPending);
  const stepperAvailable = invoicesQuery.isSuccess && (!isExpert || analysisQuery.isSuccess);

  function selectStep(step: StepId) {
    if (step === "importer") {
      const zone = importZoneRef.current;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      zone?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      zone?.focus({ preventScroll: true });
    } else if (step === "rapprocher") {
      updateSearch(
        (current) => ({ ...current, vue: "rapprochements", etape: "fournisseur" }),
        false,
      );
    } else {
      updateSearch((current) => withVue(current, "synthese"), false);
    }
  }

  const synthese = (
    <>
      {analysisLines.length > 0 ? (
        <div className="mb-8 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Total facturé (lignes rapprochées)"
              value={euro(analysis.invoiced)}
            />
            <SummaryCard label="Total au tarif catalogue" value={euro(analysis.catalog)} />
            <SummaryCard
              label={analysis.saving >= 0 ? "Économie potentielle" : "Surcoût potentiel"}
              value={euro(Math.abs(analysis.saving))}
              hint={
                analysis.savingPercent === null
                  ? undefined
                  : gapPercentLabel(analysis.savingPercent)
              }
              tone={analysis.saving >= 0 ? "good" : "bad"}
            />
            <SummaryCard
              label="Couverture du rapprochement"
              value={`${analysis.matched}/${analysis.matched + analysis.unmatched}`}
              hint={`${analysis.unmatched} ligne(s) à rapprocher`}
              tone={analysis.unmatched ? "warn" : "good"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="font-display text-lg">Analyse par fournisseur</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Fournisseur</th>
                      <th className="px-4 py-2 text-right font-medium">Facturé</th>
                      <th className="px-4 py-2 text-right font-medium">Catalogue</th>
                      <th className="px-4 py-2 text-right font-medium">Écart</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {analysis.suppliers.map(([supplier, row]) => (
                      <tr key={supplier}>
                        <td className="px-4 py-2">
                          {supplier}
                          <span className="block text-xs text-muted-foreground">
                            {row.lines} ligne(s)
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{euro(row.invoiced)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {euro(row.catalog)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums font-medium ${gapTextClass(row.gap)}`}
                        >
                          {euro(row.gap)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="font-display text-lg">Points clés</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  Sur {analysis.matched} ligne(s) rapprochée(s), {analysis.above} dépassent le tarif
                  catalogue de plus de {tolerance} % et {analysis.below} sont déjà moins chères.
                  {analysis.savingPercent !== null
                    ? ` Le potentiel global représente ${Math.abs(analysis.savingPercent).toFixed(1).replace(".", ",")} % du montant facturé comparé.`
                    : ""}
                </p>
                <div>
                  <p className="mb-2 font-medium">Plus fortes économies possibles</p>
                  <ul className="space-y-1">
                    {analysis.top.map((row) => (
                      <li key={row.id} className="flex justify-between gap-4">
                        <span className="truncate text-muted-foreground">
                          {row.label} · {row.supplier}
                        </span>
                        <span className={`tabular-nums font-medium ${gapTextClass(row.gap)}`}>
                          {euro(row.gap)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 font-medium">Lignes déjà moins chères que le catalogue</p>
                  <ul className="space-y-1">
                    {analysis.worst.map((row) => (
                      <li key={row.id} className="flex justify-between gap-4">
                        <span className="truncate text-muted-foreground">
                          {row.label} · {row.supplier}
                        </span>
                        <span className={`tabular-nums font-medium ${gapTextClass(row.gap)}`}>
                          {euro(row.gap)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button variant="outline" onClick={() => void exportAnalysis()}>
                  Exporter la synthèse fournisseur en Excel
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Comparatif Ozego</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Sur {ozegoAnalysis.matched} ligne(s) rattachée(s) à un identifiant Ozego —
                {ozegoAnalysis.unmatched > 0
                  ? ` ${ozegoAnalysis.unmatched} sans identifiant Ozego.`
                  : " toutes les lignes rapprochées en ont un."}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <SummaryCard
                  label="Moins cher — tous fournisseurs"
                  value={euro(ozegoAnalysis.best)}
                  hint={
                    ozegoAnalysis.savingPercent === null
                      ? undefined
                      : `écart ${gapPercentLabel(ozegoAnalysis.savingPercent)}`
                  }
                  tone={ozegoAnalysis.saving >= 0 ? "good" : "bad"}
                />
                <SummaryCard
                  label="Moins cher — fournisseurs préférés"
                  value={euro(ozegoAnalysis.preferredTotal)}
                  hint={
                    preferredSuppliers.length === 0
                      ? "aucun fournisseur préféré défini"
                      : `${ozegoAnalysis.preferredCount} ligne(s) trouvée(s)`
                  }
                />
              </div>
              <Button variant="outline" onClick={() => void exportOzegoAnalysis()}>
                Exporter le comparatif Ozego en Excel
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">
            {invoices.length} facture{invoices.length > 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {invoicesQuery.isLoading ? (
            <ListRowsSkeleton rows={3} />
          ) : invoices.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Aucune facture importée pour ce prospect.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {invoices.map((invoice) => {
                const status = STATUS_LABEL[invoice.status] ?? STATUS_LABEL["pending"]!;
                const count =
                  (invoice.invoice_lines as unknown as Array<{ count: number }>)?.[0]?.count ?? 0;
                return (
                  <div key={invoice.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                    <div className="min-w-56 flex-1">
                      {isExpert ? (
                        <Link
                          to="/factures/$id"
                          params={{ id: invoice.id }}
                          className="font-medium hover:text-primary"
                        >
                          {invoice.supplier_name || invoice.file_name || "Facture"}
                        </Link>
                      ) : (
                        <span className="font-medium">
                          {invoice.supplier_name || invoice.file_name || "Facture"}
                        </span>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {invoice.invoice_number ? `N° ${invoice.invoice_number} · ` : ""}
                        {shortDate(invoice.invoice_date ?? invoice.created_at)}
                        {isExpert ? ` · ${count} ligne${count > 1 ? "s" : ""}` : ""}
                      </p>
                      {invoice.error_message ? (
                        <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                          {friendlyError(invoice.error_message)}
                        </p>
                      ) : null}
                    </div>
                    {isExpert ? (
                      <span className="tabular-nums font-medium">{euro(invoice.total_ht)}</span>
                    ) : null}
                    <Badge className={status.className} variant="secondary">
                      {status.label}
                    </Badge>
                    {isExpert ? (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Voir le fichier original"
                          onClick={() => void viewInvoiceFile(invoice.file_path)}
                        >
                          <Download className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Relancer l'analyse"
                          disabled={analyse.isPending}
                          onClick={() => analyse.mutate(invoice.id)}
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Supprimer"
                          onClick={() => {
                            setInvoiceToDelete({
                              id: invoice.id,
                              path: invoice.file_path,
                              name: invoice.supplier_name || invoice.file_name || "Facture",
                              lineCount: count,
                            });
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );

  return (
    <AppShell>
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/">Comparatifs</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage>
              <CrumbText
                text={prospectQuery.data?.name || "Comparatif"}
                loading={prospectQuery.isPending}
              />
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold">
          {prospectQuery.data?.name ?? "Comparatif"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {prospectQuery.data?.notes || "Importez les factures fournisseurs de ce prospect."}
        </p>
      </div>

      {stepperLoading ? (
        <Skeleton
          className={
            isExpert ? "mb-6 h-40 rounded-lg sm:h-[4.25rem]" : "mb-6 h-[4.25rem] rounded-lg"
          }
        />
      ) : stepperAvailable ? (
        <ProspectStepper steps={steps} onSelect={selectStep} />
      ) : null}

      {isExpert ? (
        <div className="mb-8 grid items-start gap-x-4 gap-y-5 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="prospect-status">Statut</Label>
            <Select
              disabled={!prospectQuery.data}
              value={statusMeta(prospectQuery.data?.status).value}
              onValueChange={(value) => updateProspect({ status: value })}
            >
              <SelectTrigger id="prospect-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROSPECT_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prospect-delivery">Livraison souhaitée</Label>
            <Input
              id="prospect-delivery"
              type="date"
              disabled={!prospectQuery.data}
              value={prospectQuery.data?.delivery_date ?? ""}
              onChange={(event) => updateProspect({ delivery_date: event.target.value || null })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prospect-matching-suppliers">Fournisseurs de rattachement</Label>
            <SupplierMultiSelect
              id="prospect-matching-suppliers"
              placeholder="Tout le catalogue"
              description="Limite le rapprochement. Pris en compte aux prochains traitements."
              disabled={!prospectQuery.data}
              value={prospectQuery.data?.matching_suppliers ?? []}
              onChange={(next) => updateProspect({ matching_suppliers: next })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prospect-preferred-suppliers">Fournisseurs préférés</Label>
            <SupplierMultiSelect
              id="prospect-preferred-suppliers"
              placeholder="Aucun fournisseur préféré"
              description="Utilisés dans l'onglet Ozego · Fournisseurs préférés."
              disabled={!prospectQuery.data}
              value={preferredSuppliers}
              onChange={(next) => updateProspect({ preferred_suppliers: next })}
            />
          </div>
          <div
            role="status"
            aria-live="polite"
            className="-mt-2 flex h-4 items-center justify-end text-xs text-muted-foreground sm:col-span-2 xl:col-span-4"
          >
            {saved.visible ? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3.5" aria-hidden="true" />
                Enregistré
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <label
        ref={importZoneRef}
        tabIndex={-1}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void handleFiles(event.dataTransfer.files);
        }}
        className="mb-8 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card px-6 py-12 text-center outline-none transition-colors hover:border-primary/60 hover:bg-accent/30 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        {uploading ? (
          <Loader2 className="mb-3 size-8 animate-spin text-primary" />
        ) : (
          <FileUp className="mb-3 size-8 text-primary" />
        )}
        <p className="font-display text-lg font-medium">Importer les factures du prospect</p>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF ou photo — plusieurs fichiers acceptés
        </p>
      </label>

      {isExpert ? (
        <SectionTabs
          tabs={VUE_TABS(toReviewCount)}
          value={search.vue}
          onValueChange={(vue) => updateSearch((current) => withVue(current, vue), false)}
          label="Sections du comparatif"
          listClassName="mb-6"
        >
          <SectionTabPanel value="synthese">{synthese}</SectionTabPanel>
          <SectionTabPanel value="rapprochements">
            <ProspectMatchingView
              prospectId={id}
              prospectName={prospectQuery.data?.name ?? ""}
              invoices={invoices}
              tolerance={tolerance}
              preferredSuppliers={preferredSuppliers}
              search={search}
              onSearchChange={updateSearch}
            />
          </SectionTabPanel>
        </SectionTabs>
      ) : (
        synthese
      )}
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Supprimer cette facture ?"
        onConfirm={() => invoiceToDelete && void remove(invoiceToDelete.id, invoiceToDelete.path)}
      >
        <p>
          {invoiceToDelete
            ? deleteInvoiceMessage(invoiceToDelete.name, invoiceToDelete.lineCount)
            : ""}
        </p>
      </ConfirmDeleteDialog>
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "bad"
      ? "text-destructive"
      : tone === "warn"
        ? "text-warning-foreground"
        : tone === "good"
          ? "text-success"
          : "";
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
