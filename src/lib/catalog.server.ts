import { serverSupabase } from "./db.server";
import { embedTexts } from "./embeddings.server";

export type ImportProduct = {
  reference: string;
  label: string;
  ean?: string | null | undefined;
  price?: number | null | undefined;
  unit?: string | null | undefined;
  family?: string | null | undefined;
  ozego_id?: string | null | undefined;
  supplier_name?: string | null | undefined;
};

// PostgREST silently caps any unpaginated select() at its configured max rows
// (1000 here) — with 14k+ catalog_products, a plain .select() only ever saw the
// first 1000. That made every row past the first 1000 look "new" on a resync,
// so inserting it collided with the real (untracked) existing row — surfaced as
// a duplicate-key error that looked like a data problem but was this pagination
// bug. Page through with .range() instead of trusting a single unbounded select.
//
// Every caller's query MUST also add a stable .order() (e.g. by "id") before
// .range(). Without one, Postgres doesn't guarantee the same row order across
// separate requests, so successive pages can overlap or skip rows — confirmed
// against the real local catalog: an unordered .range() loop returned 15,030
// rows for a 15,030-row table, but ~7,400 of them were the same rows fetched
// twice while other real rows were skipped entirely, which then misclassified
// genuinely-existing products as "new" and hit this exact duplicate-key error.
async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data } = await query(offset, offset + pageSize - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

export async function runCatalogImport(data: { products: ImportProduct[]; source: string }) {
  const supabase = serverSupabase();

  const { data: run } = await supabase
    .from("catalog_sync_runs")
    .insert({ source: data.source, status: "running" })
    .select("id")
    .single();

  // reference alone isn't a reliable per-product identity: oze-back's real catalog has
  // suppliers reusing the same supplier_ref for genuinely different products (confirmed
  // against their live API — e.g. "france frais" ref "190016" is both "Chaource AOP 250g"
  // and "Époisse 250g"). ozego_id is oze-back's actual product identity, so prefer it;
  // manual CSV import (importCatalog) doesn't always supply one, so fall back to
  // reference in that case — matches catalog_products_reference_key's own definition.
  const productKey = (
    supplierName: string | null | undefined,
    reference: string,
    ozegoId: string | null | undefined,
  ) =>
    `${(supplierName ?? "").trim().toLowerCase()}::${(ozegoId ?? reference).trim().toLowerCase()}`;

  try {
    const seen = new Map<string, ImportProduct>();
    for (const product of data.products) {
      seen.set(productKey(product.supplier_name, product.reference, product.ozego_id), {
        ...product,
        reference: product.reference.trim(),
        label: product.label.trim(),
      });
    }
    const rows = [...seen.values()];

    const existing = await fetchAllRows((from, to) =>
      supabase
        .from("catalog_products")
        .select("id, reference, label, supplier_name, ozego_id, source, is_active")
        .order("id", { ascending: true })
        .range(from, to),
    );
    const existingIndex = new Map<string, { id: string; label: string }>();
    for (const item of existing) {
      existingIndex.set(productKey(item.supplier_name, item.reference, item.ozego_id), {
        id: item.id,
        label: item.label,
      });
    }

    const toInsert = rows.filter(
      (row) => !existingIndex.has(productKey(row.supplier_name, row.reference, row.ozego_id)),
    );
    const toUpdate = rows.filter((row) =>
      existingIndex.has(productKey(row.supplier_name, row.reference, row.ozego_id)),
    );

    const needsEmbedding: Array<{ id: string; label: string }> = [];

    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500).map((row) => ({
        reference: row.reference,
        label: row.label,
        ean: row.ean ?? null,
        price: row.price ?? null,
        unit: row.unit ?? null,
        family: row.family ?? null,
        ozego_id: row.ozego_id ?? null,
        supplier_name: row.supplier_name ?? null,
        source: data.source,
        is_active: true,
      }));
      const { data: inserted, error } = await supabase
        .from("catalog_products")
        .insert(chunk)
        .select("id, label");
      if (error) throw new Error(error.message);
      needsEmbedding.push(...(inserted ?? []));
    }

    for (const row of toUpdate) {
      const current = existingIndex.get(
        productKey(row.supplier_name, row.reference, row.ozego_id),
      )!;
      const { error } = await supabase
        .from("catalog_products")
        .update({
          label: row.label,
          ean: row.ean ?? null,
          price: row.price ?? null,
          unit: row.unit ?? null,
          family: row.family ?? null,
          ozego_id: row.ozego_id ?? null,
          supplier_name: row.supplier_name ?? null,
          source: data.source,
          is_active: true,
        })
        .eq("id", current.id);
      if (error) throw new Error(error.message);
      if (current.label !== row.label) needsEmbedding.push({ id: current.id, label: row.label });
    }

    // Sync is additive by nature (insert/update), so a product dropped from this
    // source's feed would otherwise stay active forever — polluting matching with
    // dead products. Deactivate (never delete, to preserve history/FK references
    // from invoice_lines & product_mappings) any row from this same source that
    // wasn't seen in this run. Scoped to `source` so an ERP sync never touches
    // rows from a manual CSV import (or vice versa).
    const currentKeys = new Set(
      rows.map((row) => productKey(row.supplier_name, row.reference, row.ozego_id)),
    );
    const toDeactivate = existing.filter(
      (item) =>
        item.source === data.source &&
        item.is_active &&
        !currentKeys.has(productKey(item.supplier_name, item.reference, item.ozego_id)),
    );
    // Unlike the insert/update chunks above (POST body), `.in("id", chunk)` puts every id in
    // the request URL's query string — 500 UUIDs there overflows PostgREST's URL length limit
    // ("URI too long", confirmed against the real local stack). A far smaller chunk keeps it safe.
    let deactivated = 0;
    for (let i = 0; i < toDeactivate.length; i += 50) {
      const chunk = toDeactivate.slice(i, i + 50).map((item) => item.id);
      const { error } = await supabase
        .from("catalog_products")
        .update({ is_active: false })
        .in("id", chunk);
      if (error) throw new Error(error.message);
      deactivated += chunk.length;
    }

    // Fill in any product still missing a semantic fingerprint. Uncapped: with a
    // catalog this size, one sync run's worth of missing embeddings can exceed
    // any fixed limit — see fetchAllRows' comment for why a plain .limit() alone
    // isn't enough once the true count passes PostgREST's page size.
    const missing = await fetchAllRows((from, to) =>
      supabase
        .from("catalog_products")
        .select("id, label")
        .is("embedding", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const item of missing) {
      if (!needsEmbedding.some((entry) => entry.id === item.id)) needsEmbedding.push(item);
    }

    let embedded = 0;
    if (needsEmbedding.length > 0) {
      try {
        const vectors = await embedTexts(needsEmbedding.map((item) => item.label));
        for (let i = 0; i < needsEmbedding.length; i += 1) {
          const vector = vectors[i];
          if (!vector) continue;
          await supabase
            .from("catalog_products")
            .update({ embedding: JSON.stringify(vector) as unknown as string })
            .eq("id", needsEmbedding[i]!.id);
          embedded += 1;
        }
      } catch (error) {
        console.error("embedding failed", error);
      }
    }

    if (run) {
      await supabase
        .from("catalog_sync_runs")
        .update({
          status: "success",
          products_count: rows.length,
          message: `${toInsert.length} ajoutés, ${toUpdate.length} mis à jour, ${deactivated} désactivés, ${embedded} indexés`,
        })
        .eq("id", run.id);
    }

    return { inserted: toInsert.length, updated: toUpdate.length, deactivated, embedded };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    if (run) {
      await supabase
        .from("catalog_sync_runs")
        .update({ status: "error", message })
        .eq("id", run.id);
    }
    throw new Error(message);
  }
}
