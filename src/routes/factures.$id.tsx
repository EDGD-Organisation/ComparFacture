import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, Download, Loader2, Pencil, RefreshCw, X } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { ProductPicker, type PickedProduct } from "@/components/ProductPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { rematchInvoice } from "@/lib/invoices.functions";
import { euro, lineGap, num, percent, shortDate } from "@/lib/format";
import { comparableUnitPrice } from "@/lib/pack";
import {
  cheapestAmong,
  fetchCheapestByOzego,
  fetchOzegoVariants,
  ozegoGap,
  type OzegoBest,
  type OzegoVariant,
} from "@/lib/ozego";
import { Input } from "@/components/ui/input";

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

function InvoiceDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState<Line | null>(null);
  const [mode, setMode] = useState<
    "fournisseur" | "ozego" | "recap" | "achat" | "ozego-meme" | "ozego-preferes"
  >("recap");
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
          "id, line_number, supplier_reference, label, quantity, unit, unit_price, discount_percent, line_total, match_status, match_score, match_method, manual_override, pack_factor, matched_product_id, catalog_products(id, reference, label, price, unit, ean, family, currency, ozego_id, supplier_name)",
        )
        .eq("invoice_id", id)
        .order("line_number");
      if (error) throw new Error(error.message);
      return data as unknown as Line[];
    },
  });

  const ozegoIds = (linesQuery.data ?? [])
    .map((line) => line.catalog_products?.ozego_id ?? null)
    .filter((value): value is string => Boolean(value));

  const ozegoQuery = useQuery({
    queryKey: ["ozego-best", [...new Set(ozegoIds)].sort().join(",")],
    enabled: ozegoIds.length > 0,
    queryFn: () => fetchCheapestByOzego(ozegoIds),
  });

  const ozegoVariantsQuery = useQuery({
    queryKey: ["ozego-variants", [...new Set(ozegoIds)].sort().join(",")],
    enabled: ozegoIds.length > 0,
    queryFn: () => fetchOzegoVariants(ozegoIds),
  });

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

  const relaunch = useMutation({
    mutationFn: () => rematch({ data: { invoiceId: id } }),
    onSuccess: () => {
      toast.success("Rapprochement relancé");
      queryClient.invalidateQueries({ queryKey: ["invoice-lines", id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function applyMatch(line: Line, product: PickedProduct | null) {
    const { error } = await supabase
      .from("invoice_lines")
      .update({
        matched_product_id: product?.id ?? null,
        match_status: product ? "confirmed" : "unmatched",
        match_method: product ? "manuel" : null,
        match_score: product ? 1 : null,
        manual_override: true,
      })
      .eq("id", line.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (product && (line.supplier_reference || line.label)) {
      const supplierName = invoiceQuery.data?.supplier_name ?? null;
      let existing = supabase.from("product_mappings").select("id");
      existing = supplierName
        ? existing.ilike("supplier_name", supplierName)
        : existing.is("supplier_name", null);
      existing = line.supplier_reference
        ? existing.ilike("supplier_reference", line.supplier_reference)
        : existing.ilike("supplier_label", line.label);
      const { data: found } = await existing.maybeSingle();

      if (found) {
        await supabase
          .from("product_mappings")
          .update({ product_id: product.id, pack_factor: line.pack_factor ?? 1 })
          .eq("id", found.id);
      } else {
        await supabase.from("product_mappings").insert({
          supplier_name: supplierName,
          supplier_reference: line.supplier_reference,
          supplier_label: line.label,
          product_id: product.id,
          pack_factor: line.pack_factor ?? 1,
        });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["invoice-lines", id] });
    toast.success(product ? "Correspondance enregistrée" : "Correspondance retirée");
  }

  async function confirm(line: Line) {
    await supabase
      .from("invoice_lines")
      .update({ match_status: "confirmed", manual_override: true })
      .eq("id", line.id);
    queryClient.invalidateQueries({ queryKey: ["invoice-lines", id] });
  }

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
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["invoice-lines", id] });
  }

  async function savePackFactor(line: Line, value: number) {
    const factor = Number.isFinite(value) && value > 0 ? value : 1;
    const { error } = await supabase
      .from("invoice_lines")
      .update({ pack_factor: factor })
      .eq("id", line.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    const supplierName = invoiceQuery.data?.supplier_name ?? null;
    if (line.matched_product_id) {
      let existing = supabase.from("product_mappings").select("id");
      existing = supplierName
        ? existing.ilike("supplier_name", supplierName)
        : existing.is("supplier_name", null);
      existing = line.supplier_reference
        ? existing.ilike("supplier_reference", line.supplier_reference)
        : existing.ilike("supplier_label", line.label);
      const { data: found } = await existing.maybeSingle();
      if (found) {
        await supabase.from("product_mappings").update({ pack_factor: factor }).eq("id", found.id);
      } else {
        await supabase.from("product_mappings").insert({
          supplier_name: supplierName,
          supplier_reference: line.supplier_reference,
          supplier_label: line.label,
          product_id: line.matched_product_id,
          pack_factor: factor,
        });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["invoice-lines", id] });
  }

  const invoice = invoiceQuery.data;
  const lines = linesQuery.data ?? [];
  const tolerance = settingsQuery.data?.tolerance_percent ?? 2;

  const totals = lines.reduce(
    (acc, line) => {
      const gap = lineGap(
        line.unit_price,
        line.catalog_products?.price ?? null,
        line.quantity,
        line.pack_factor,
      );
      if (gap) {
        acc.total += gap.totalGap;
        if (Math.abs(gap.percentGap ?? 0) > tolerance) acc.anomalies += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { total: 0, anomalies: 0, unmatched: 0 },
  );

  const bestByOzego: Map<string, OzegoBest> = ozegoQuery.data ?? new Map();
  const ozegoTotals = lines.reduce(
    (acc, line) => {
      const best = line.catalog_products?.ozego_id
        ? bestByOzego.get(line.catalog_products.ozego_id)
        : undefined;
      const gap = ozegoGap(line, best);
      if (gap) {
        acc.total += gap.totalGap;
        if (Math.abs(gap.percentGap ?? 0) > tolerance) acc.anomalies += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { total: 0, anomalies: 0, unmatched: 0 },
  );

  const { invoicedTotal, catalogTotal, bestTotal } = lines.reduce(
    (acc, line) => {
      const catalogPrice = line.catalog_products?.price ?? null;
      const sup = lineGap(line.unit_price, catalogPrice, line.quantity, line.pack_factor);
      const k = sup?.packFactor ?? (line.pack_factor || 1);
      if (sup) {
        acc.invoicedTotal += (line.unit_price ?? 0) * line.quantity;
        acc.catalogTotal += (catalogPrice ?? 0) * line.quantity * k;
      }
      const ozegoId = line.catalog_products?.ozego_id ?? null;
      const best = ozegoId ? bestByOzego.get(ozegoId) : undefined;
      const oz = ozegoGap(line, best);
      if (oz) {
        acc.bestTotal += (best?.price ?? 0) * line.quantity * k;
      }
      return acc;
    },
    { invoicedTotal: 0, catalogTotal: 0, bestTotal: 0 },
  );

  const variantsByOzego: Map<string, OzegoVariant[]> = ozegoVariantsQuery.data ?? new Map();
  const preferredSuppliers = preferredSuppliersQuery.data ?? [];
  const invoiceSupplier = invoice?.supplier_name || invoice?.file_name || null;

  function sameSupplierRowFor(line: Line) {
    const ozegoId = line.catalog_products?.ozego_id ?? null;
    const variants = ozegoId ? variantsByOzego.get(ozegoId) : undefined;
    return cheapestAmong(variants, invoiceSupplier ? [invoiceSupplier] : null);
  }

  function preferredRowFor(line: Line) {
    const ozegoId = line.catalog_products?.ozego_id ?? null;
    const variants = ozegoId ? variantsByOzego.get(ozegoId) : undefined;
    return cheapestAmong(variants, preferredSuppliers);
  }

  const sameSupplierTotals = lines.reduce(
    (acc, line) => {
      const row = sameSupplierRowFor(line);
      const gap = ozegoGap(line, row);
      if (gap) {
        acc.total += gap.totalGap;
        acc.bestTotal += (row?.price ?? 0) * line.quantity * gap.packFactor;
        if (Math.abs(gap.percentGap ?? 0) > tolerance) acc.anomalies += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { total: 0, bestTotal: 0, anomalies: 0, unmatched: 0 },
  );

  const preferredTotals = lines.reduce(
    (acc, line) => {
      const row = preferredRowFor(line);
      const gap = ozegoGap(line, row);
      if (gap) {
        acc.total += gap.totalGap;
        acc.bestTotal += (row?.price ?? 0) * line.quantity * gap.packFactor;
        if (Math.abs(gap.percentGap ?? 0) > tolerance) acc.anomalies += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { total: 0, bestTotal: 0, anomalies: 0, unmatched: 0 },
  );

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
      const k = gap?.packFactor ?? (line.pack_factor || 1);
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
      const k = gap?.packFactor ?? (line.pack_factor || 1);
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
      const k = sup?.packFactor ?? (line.pack_factor || 1);
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
    <AppShell>
      {invoice?.prospect_id ? (
        <Link
          to="/comparatifs/$id"
          params={{ id: invoice.prospect_id }}
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Retour au comparatif
        </Link>
      ) : (
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Retour aux comparatifs
        </Link>
      )}

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

      <div className="mb-6 flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => setMode("achat")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            mode === "achat" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Achat client
        </button>
        <button
          type="button"
          onClick={() => setMode("recap")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            mode === "recap" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Récapitulatif
        </button>
        <button
          type="button"
          onClick={() => setMode("fournisseur")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            mode === "fournisseur" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Comparatif référence fournisseur
        </button>
        <button
          type="button"
          onClick={() => setMode("ozego-meme")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            mode === "ozego-meme" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Ozego · Même fournisseur
        </button>
        <button
          type="button"
          onClick={() => setMode("ozego")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            mode === "ozego" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Ozego · Autres fournisseurs (moins cher)
        </button>
        <button
          type="button"
          onClick={() => setMode("ozego-preferes")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            mode === "ozego-preferes" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Ozego · Fournisseurs préférés
        </button>
      </div>

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

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Récapitulatif ligne par ligne</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Ligne facture</th>
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
                    {lines.map((line) => {
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
                        <tr key={line.id} className={out ? "bg-destructive/5" : undefined}>
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
                            {(line.pack_factor ?? 1) !== 1 ? (
                              <span className="block text-xs text-muted-foreground">
                                cond. ×{line.pack_factor}
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
                {lines.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    Aucune ligne extraite pour cette facture.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      ) : mode === "achat" ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <StatCard label="Total facturé" value={euro(invoicedTotal)} tone="good" />
            <StatCard label="Lignes" value={String(lines.length)} tone="good" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Achat client</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Ligne facture</th>
                      <th className="px-4 py-3 text-right font-medium">Qté</th>
                      <th className="px-4 py-3 font-medium">Unité</th>
                      <th className="px-4 py-3 text-right font-medium">PU facturé</th>
                      <th className="px-4 py-3 text-right font-medium">Remise %</th>
                      <th className="px-4 py-3 text-right font-medium">Total ligne</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-3">
                          <span className="block font-medium">{line.label}</span>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {line.supplier_reference || "sans référence"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {line.quantity}
                          {(line.pack_factor ?? 1) !== 1 ? (
                            <span className="block text-xs text-muted-foreground">
                              cond. ×{line.pack_factor}
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
                {lines.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    Aucune ligne extraite pour cette facture.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      ) : mode === "ozego-meme" ? (
        <OzegoComparisonTable
          lines={lines}
          cardTitle={`Prix le moins cher chez ${invoiceSupplier ?? "ce fournisseur"}`}
          referenceColumnLabel="Référence même fournisseur"
          unmatchedLabel="Lignes sans offre chez ce fournisseur"
          statLabel="Écart vs Ozego même fournisseur"
          noOfferLabel="Hors Mercurial"
          rowFor={sameSupplierRowFor}
          totals={sameSupplierTotals}
          invoicedTotal={invoicedTotal}
          tolerance={tolerance}
          onSaveLineField={(line, patch) => void saveLineField(line, patch)}
          onSavePackFactor={(line, value) => void savePackFactor(line, value)}
          onPick={setPicking}
          onUnmatch={(line) => void applyMatch(line, null)}
        />
      ) : mode === "ozego" ? (
        <OzegoComparisonTable
          lines={lines}
          cardTitle="Meilleur prix par identifiant Ozego"
          referenceColumnLabel="Référence la moins chère"
          unmatchedLabel="Lignes sans identifiant Ozego"
          statLabel="Écart vs meilleur prix Ozego"
          rowFor={(line) => {
            const ozegoId = line.catalog_products?.ozego_id ?? null;
            return ozegoId ? bestByOzego.get(ozegoId) : undefined;
          }}
          totals={{ ...ozegoTotals, bestTotal }}
          invoicedTotal={invoicedTotal}
          tolerance={tolerance}
          onSaveLineField={(line, patch) => void saveLineField(line, patch)}
          onSavePackFactor={(line, value) => void savePackFactor(line, value)}
          onPick={setPicking}
          onUnmatch={(line) => void applyMatch(line, null)}
        />
      ) : mode === "ozego-preferes" ? (
        <OzegoComparisonTable
          lines={lines}
          cardTitle="Meilleur prix chez vos fournisseurs préférés"
          referenceColumnLabel="Référence fournisseur préféré"
          unmatchedLabel={
            preferredSuppliers.length === 0
              ? "Aucun fournisseur préféré défini"
              : "Lignes sans offre préférée"
          }
          statLabel="Écart vs Ozego fournisseurs préférés"
          rowFor={preferredRowFor}
          totals={preferredTotals}
          invoicedTotal={invoicedTotal}
          tolerance={tolerance}
          onSaveLineField={(line, patch) => void saveLineField(line, patch)}
          onSavePackFactor={(line, value) => void savePackFactor(line, value)}
          onPick={setPicking}
          onUnmatch={(line) => void applyMatch(line, null)}
        />
      ) : (
        <>
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

          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg">Comparatif ligne par ligne</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Ligne facture</th>
                        <th className="px-4 py-3 font-medium">Produit catalogue</th>
                        <th className="px-4 py-3 font-medium">Unité de négo + nom du fournisseur</th>
                        <th className="px-4 py-3 text-right font-medium">Qté</th>
                        <th className="px-4 py-3 text-right font-medium">PU facturé</th>
                        <th className="px-4 py-3 text-right font-medium">Cond.</th>
                        <th className="px-4 py-3 text-right font-medium">PU comparable</th>
                        <th className="px-4 py-3 text-right font-medium">PU catalogue</th>
                        <th className="px-4 py-3 text-right font-medium">Écart</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lines.map((line) => {
                        const catalogPrice = line.catalog_products?.price ?? null;
                        const gap = lineGap(
                          line.unit_price,
                          catalogPrice,
                          line.quantity,
                          line.pack_factor,
                        );
                        const out =
                          gap?.percentGap !== null && gap && Math.abs(gap.percentGap!) > tolerance;
                        return (
                          <tr key={line.id} className={out ? "bg-destructive/5" : undefined}>
                            <td className="px-4 py-3">
                              <span className="block font-medium">{line.label}</span>
                              <span className="block font-mono text-xs text-muted-foreground">
                                {line.supplier_reference || "sans référence"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {line.catalog_products ? (
                                <>
                                  <span className="block">{line.catalog_products.label}</span>
                                  <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                                    {line.catalog_products.reference}
                                    <MatchBadge line={line} />
                                  </span>
                                  {line.match_method !== "reference" ? (
                                    <span className="block text-xs text-warning-foreground">
                                      Pas rapproché par la référence fournisseur (
                                      {line.match_method === "mapping"
                                        ? "correspondance mémorisée"
                                        : "libellé"}
                                      )
                                    </span>
                                  ) : null}
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
                            </td>
                            <td className="px-4 py-3">
                              {line.catalog_products ? (
                                <>
                                  <span className="block">
                                    {line.catalog_products.unit || "—"}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    {line.catalog_products.supplier_name ?? "—"}
                                  </span>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <EditableCell
                                  value={line.quantity}
                                  title="Quantité facturée"
                                  className="w-20"
                                  onSave={(value) =>
                                    void saveLineField(line, { quantity: Number(value) })
                                  }
                                />
                                <EditableText
                                  value={line.unit ?? ""}
                                  title="Unité facturée (kg, carton, L…)"
                                  className="w-16"
                                  onSave={(value) =>
                                    void saveLineField(line, { unit: value || null })
                                  }
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <EditableCell
                                value={line.unit_price}
                                title="Prix unitaire facturé"
                                className="ml-auto w-24"
                                onSave={(value) => void saveLineField(line, { unit_price: value })}
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <PackFactorInput
                                value={line.pack_factor ?? 1}
                                onSave={(value) => void savePackFactor(line, value)}
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
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-1">
                                {line.catalog_products && line.match_status !== "confirmed" ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Valider la correspondance"
                                    onClick={() => void confirm(line)}
                                  >
                                    <Check className="size-4 text-success" />
                                  </Button>
                                ) : null}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Modifier la correspondance"
                                  onClick={() => setPicking(line)}
                                >
                                  <Pencil className="size-4" />
                                </Button>
                                {line.catalog_products ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Retirer la correspondance"
                                    onClick={() => void applyMatch(line, null)}
                                  >
                                    <X className="size-4 text-destructive" />
                                  </Button>
                                ) : null}
                              </div>
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
                        <td className="px-4 py-3" />
                      </tr>
                    </tfoot>
                  </table>
                  {linesQuery.isLoading ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">Chargement…</p>
                  ) : lines.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      Aucune ligne extraite pour cette facture.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {picking ? (
        <ProductPicker
          open
          onOpenChange={(open) => !open && setPicking(null)}
          initialSearch={picking.supplier_reference || picking.label}
          onPick={(product) => void applyMatch(picking, product)}
        />
      ) : null}
    </AppShell>
  );
}

function EditableCell({
  value,
  title,
  className,
  onSave,
}: {
  value: number | null;
  title: string;
  className?: string;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);

  const commit = () => {
    const raw = draft.trim();
    if (raw === "") {
      if (value !== null) onSave(null);
      return;
    }
    const parsed = Number(raw.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(value === null ? "" : String(value));
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

function EditableText({
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

function PackFactorInput({ value, onSave }: { value: number; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(value));
      return;
    }
    if (parsed !== value) onSave(parsed);
  };

  return (
    <Input
      value={draft}
      inputMode="decimal"
      title="Nombre d'unités catalogue par unité facturée"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      className="ml-auto h-8 w-16 text-right tabular-nums"
    />
  );
}

function MatchBadge({ line }: { line: Line }) {
  if (line.match_status === "confirmed") {
    return (
      <Badge variant="secondary" className="bg-success/15 text-success">
        Validé
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      {line.match_method ?? "auto"}
      {line.match_score !== null ? ` ${Math.round(line.match_score * 100)} %` : ""}
    </Badge>
  );
}

type OzegoRow = {
  label: string;
  reference: string;
  supplier_name: string | null;
  unit: string | null;
  price: number | null;
};

/**
 * Shared table for the 3 Ozego comparison views (même fournisseur / tous fournisseurs
 * moins cher / fournisseurs préférés) — same columns and edit actions, only `rowFor`
 * (which reference price to compare against) and the surrounding labels differ.
 */
function OzegoComparisonTable({
  lines,
  cardTitle,
  referenceColumnLabel,
  unmatchedLabel,
  statLabel,
  noOfferLabel = "—",
  rowFor,
  totals,
  invoicedTotal,
  tolerance,
  onSaveLineField,
  onSavePackFactor,
  onPick,
  onUnmatch,
}: {
  lines: Line[];
  cardTitle: string;
  referenceColumnLabel: string;
  unmatchedLabel: string;
  statLabel: string;
  /** Shown in the reference column when the product has an Ozego group but this
   * supplier scope carries no variant for it (as opposed to no Ozego group at all,
   * which keeps the "Sans identifiant" badge) — e.g. "Hors Mercurial" for the
   * "même fournisseur" view, meaning the product isn't in that supplier's price list. */
  noOfferLabel?: string;
  rowFor: (line: Line) => OzegoRow | undefined;
  totals: { total: number; bestTotal: number; anomalies: number; unmatched: number };
  invoicedTotal: number;
  tolerance: number;
  onSaveLineField: (
    line: Line,
    patch: Partial<Pick<Line, "quantity" | "unit" | "unit_price">>,
  ) => void;
  onSavePackFactor: (line: Line, value: number) => void;
  onPick: (line: Line) => void;
  onUnmatch: (line: Line) => void;
}) {
  return (
    <>
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

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">{cardTitle}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Ligne facture</th>
                  <th className="px-4 py-3 font-medium">Identifiant Ozego</th>
                  <th className="px-4 py-3 font-medium">{referenceColumnLabel}</th>
                  <th className="px-4 py-3 font-medium">Unité de négo + nom du fournisseur</th>
                  <th className="px-4 py-3 text-right font-medium">Qté</th>
                  <th className="px-4 py-3 text-right font-medium">PU facturé</th>
                  <th className="px-4 py-3 text-right font-medium">Cond.</th>
                  <th className="px-4 py-3 text-right font-medium">PU comparable</th>
                  <th className="px-4 py-3 text-right font-medium">PU référence</th>
                  <th className="px-4 py-3 text-right font-medium">Écart</th>
                  <th className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line) => {
                  const ozegoId = line.catalog_products?.ozego_id ?? null;
                  const row = rowFor(line);
                  const gap = ozegoGap(line, row);
                  const out = gap && Math.abs(gap.percentGap ?? 0) > tolerance;
                  return (
                    <tr key={line.id} className={out ? "bg-destructive/5" : undefined}>
                      <td className="px-4 py-3">
                        <span className="block font-medium">{line.label}</span>
                        <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                          {line.supplier_reference || "sans référence"}
                          {line.catalog_products ? <MatchBadge line={line} /> : null}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {ozegoId ? (
                          <span className="block font-mono text-xs">{ozegoId}</span>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-warning/20 text-warning-foreground"
                          >
                            Sans identifiant
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row ? (
                          <>
                            <span className="block">{row.label}</span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {row.reference}
                            </span>
                          </>
                        ) : ozegoId ? (
                          <span className="text-xs italic text-muted-foreground">
                            {noOfferLabel}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row ? (
                          <>
                            <span className="block">{row.unit || "—"}</span>
                            <span className="block text-xs text-muted-foreground">
                              {row.supplier_name ?? "—"}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
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
                      </td>
                      <td className="px-4 py-3 text-right">
                        <EditableCell
                          value={line.unit_price}
                          title="Prix unitaire facturé"
                          className="ml-auto w-24"
                          onSave={(value) => onSaveLineField(line, { unit_price: value })}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <PackFactorInput
                          value={line.pack_factor ?? 1}
                          onSave={(value) => onSavePackFactor(line, value)}
                        />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {euro(comparableUnitPrice(line.unit_price, line.pack_factor))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {euro(row?.price ?? null)}
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
                        {gap ? (
                          <>
                            <span className="block">{euro(gap.totalGap)}</span>
                            <span className="block text-xs">{percent(gap.percentGap)}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Modifier la correspondance"
                            onClick={() => onPick(line)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          {line.catalog_products ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Retirer la correspondance"
                              onClick={() => onUnmatch(line)}
                            >
                              <X className="size-4 text-destructive" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/60 font-medium">
                <tr>
                  <td className="px-4 py-3" colSpan={5}>
                    Total
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{euro(invoicedTotal)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {euro(totals.bestTotal)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${totals.total > 0 ? "text-destructive" : totals.total < 0 ? "text-success" : ""}`}
                  >
                    {euro(totals.total)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
            {lines.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Aucune ligne extraite pour cette facture.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({
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
