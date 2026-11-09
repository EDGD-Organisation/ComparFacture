import { stageLabel } from "./line-actions";
import { stripAccents } from "./match-normalize";
import { comparableUnitPrice, normalizePackFactor } from "./pack";

export { fetchAllRows, type PageResult, type RangeQuery } from "./paginate";

export type MatchingInvoice = {
  id: string;
  supplier_name: string | null;
  file_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string | null;
};

export type MatchingProduct = {
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
};

export type MatchingLine = {
  id: string;
  invoice_id: string;
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
  invoices: MatchingInvoice | null;
  catalog_products: MatchingProduct | null;
};

export type RowStatus = "confirmed" | "review" | "unmatched";

export const STATUS_LABEL: Record<RowStatus, string> = {
  confirmed: "Confirmé",
  review: "À vérifier",
  unmatched: "Non rapproché",
};

export const ROW_STATUSES: RowStatus[] = ["confirmed", "review", "unmatched"];

export function rowStatus(line: MatchingLine): RowStatus {
  if (!line.catalog_products) return "unmatched";
  return line.match_status === "confirmed" ? "confirmed" : "review";
}

export type ValidationFilter = "all" | "validated" | "unvalidated";

export type MatchingFilters = {
  search: string;
  status: RowStatus | "all";
  invoiceId: string;
  supplier: string;
  validation: ValidationFilter;
};

export const ALL = "all";

export const DEFAULT_FILTERS: MatchingFilters = {
  search: "",
  status: ALL,
  invoiceId: ALL,
  supplier: ALL,
  validation: ALL,
};

export function filtersActive(filters: MatchingFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.status !== ALL ||
    filters.invoiceId !== ALL ||
    filters.supplier !== ALL ||
    filters.validation !== ALL
  );
}

export function normalizeForSearch(value: string): string {
  return stripAccents(value).toLowerCase();
}

/** Même critère que le filtre de la page facture : « validée » = correspondance confirmée. */
export function isValidated(line: MatchingLine): boolean {
  return line.match_status === "confirmed";
}

export function supplierLabel(line: MatchingLine): string {
  return line.invoices?.supplier_name || line.invoices?.file_name || "Fournisseur inconnu";
}

export function invoiceTitle(invoice: MatchingInvoice | null): string {
  if (!invoice) return "Facture";
  return invoice.file_name || (invoice.invoice_number ? `N° ${invoice.invoice_number}` : "Facture");
}

function invoiceOptionLabel(invoice: MatchingInvoice): string {
  return (
    [
      invoice.supplier_name,
      invoice.invoice_number ? `N° ${invoice.invoice_number}` : null,
      invoice.file_name,
    ]
      .filter(Boolean)
      .join(" · ") || "Facture"
  );
}

const haystacks = new WeakMap<MatchingLine, string>();

function haystack(line: MatchingLine): string {
  let cached = haystacks.get(line);
  if (cached === undefined) {
    cached = normalizeForSearch(
      [
        line.label,
        line.supplier_reference,
        line.catalog_products?.label,
        line.catalog_products?.reference,
        line.catalog_products?.ozego_id,
      ]
        .filter(Boolean)
        .join(" "),
    );
    haystacks.set(line, cached);
  }
  return cached;
}

export function matchesFilters(line: MatchingLine, filters: MatchingFilters): boolean {
  if (filters.status !== ALL && rowStatus(line) !== filters.status) return false;
  if (filters.invoiceId !== ALL && line.invoice_id !== filters.invoiceId) return false;
  if (filters.supplier !== ALL && supplierLabel(line) !== filters.supplier) return false;
  if (filters.validation === "validated" && !isValidated(line)) return false;
  if (filters.validation === "unvalidated" && isValidated(line)) return false;
  const needle = normalizeForSearch(filters.search.trim());
  return needle === "" || haystack(line).includes(needle);
}

export function filterLines(lines: MatchingLine[], filters: MatchingFilters): MatchingLine[] {
  return lines.filter((line) => matchesFilters(line, filters));
}

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

/** Ordre par défaut : fournisseur, date de facture, facture, n° de ligne, puis id (jamais d'ex aequo). */
export function sortLines(lines: MatchingLine[]): MatchingLine[] {
  return [...lines].sort(
    (a, b) =>
      collator.compare(supplierLabel(a), supplierLabel(b)) ||
      (a.invoices?.invoice_date ?? "").localeCompare(b.invoices?.invoice_date ?? "") ||
      a.invoice_id.localeCompare(b.invoice_id) ||
      a.line_number - b.line_number ||
      a.id.localeCompare(b.id),
  );
}

export type StatusCounts = Record<RowStatus, number> & { all: number };

export function countByStatus(lines: MatchingLine[]): StatusCounts {
  const counts: StatusCounts = { all: lines.length, confirmed: 0, review: 0, unmatched: 0 };
  for (const line of lines) counts[rowStatus(line)] += 1;
  return counts;
}

export function invoiceOptions(lines: MatchingLine[]): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const line of lines) {
    if (line.invoices && !seen.has(line.invoice_id)) {
      seen.set(line.invoice_id, invoiceOptionLabel(line.invoices));
    }
  }
  return [...seen.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => collator.compare(a.label, b.label) || a.id.localeCompare(b.id));
}

export function supplierOptions(lines: MatchingLine[]): string[] {
  return [...new Set(lines.map(supplierLabel))].sort(collator.compare);
}

export type Page<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
};

export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(requested, 1), pageCount);
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: current,
    pageCount,
    total: items.length,
    from: slice.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

/** Méthode affichée : « manuel » dès qu'un humain est intervenu, comme dans les exports existants. */
export function methodLabel(line: MatchingLine): string {
  if (!line.catalog_products) return "";
  if (line.manual_override) return "manuel";
  return line.match_method ?? "auto";
}

export function buildExportRows(lines: MatchingLine[]): Array<Record<string, string | number>> {
  return lines.map((line) => {
    const product = line.catalog_products;
    return {
      "Facture (fichier)": line.invoices?.file_name ?? "",
      "N° facture": line.invoices?.invoice_number ?? "",
      "Date facture": line.invoices?.invoice_date ?? "",
      "Fournisseur (facture)": supplierLabel(line),
      "N° ligne": line.line_number,
      "Référence fournisseur": line.supplier_reference ?? "",
      "Désignation fournisseur": line.label,
      Quantité: line.quantity,
      Unité: line.unit ?? "",
      "PU facturé": line.unit_price ?? "",
      "Coef. conditionnement": normalizePackFactor(line.pack_factor),
      "PU comparable": comparableUnitPrice(line.unit_price, line.pack_factor) ?? "",
      "Référence catalogue": product?.reference ?? "",
      "Libellé catalogue": product?.label ?? "",
      "Fournisseur catalogue": product?.supplier_name ?? "",
      "Identifiant Ozego": product?.ozego_id ?? "",
      "Unité catalogue": product?.unit ?? "",
      "PU catalogue": product?.price ?? "",
      Méthode: methodLabel(line),
      "Score de rapprochement": product ? (line.match_score ?? "") : "",
      Statut: STATUS_LABEL[rowStatus(line)],
      Validation: stageLabel(line.validated_stage) ?? "Non validée",
    };
  });
}

export type RematchFailure = { invoiceId: string; label: string; message: string };
export type RematchSummary = {
  total: number;
  succeeded: number;
  updatedLines: number;
  failed: RematchFailure[];
};

/** Re-rapproche les factures une par une ; une erreur est consignée dans le résumé et n'arrête pas la suite. */
export async function rematchSequentially(
  invoices: Array<{ id: string; label: string }>,
  run: (invoiceId: string) => Promise<{ updated: number }>,
  onProgress?: (done: number, total: number, current: string | null) => void,
): Promise<RematchSummary> {
  const summary: RematchSummary = {
    total: invoices.length,
    succeeded: 0,
    updatedLines: 0,
    failed: [],
  };
  for (const [index, invoice] of invoices.entries()) {
    onProgress?.(index, invoices.length, invoice.label);
    try {
      const result = await run(invoice.id);
      summary.succeeded += 1;
      summary.updatedLines += result.updated;
    } catch (error) {
      summary.failed.push({
        invoiceId: invoice.id,
        label: invoice.label,
        message: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }
  onProgress?.(invoices.length, invoices.length, null);
  return summary;
}
