import { serverSupabase } from "./db.server";
import { embedTexts } from "./ai.server";

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

export async function runCatalogImport(data: { products: ImportProduct[]; source: string }) {
  const supabase = serverSupabase();

  const { data: run } = await supabase
    .from("catalog_sync_runs")
    .insert({ source: data.source, status: "running" })
    .select("id")
    .single();

  try {
    const seen = new Map<string, ImportProduct>();
    for (const product of data.products) {
      seen.set(product.reference.trim().toLowerCase(), {
        ...product,
        reference: product.reference.trim(),
        label: product.label.trim(),
      });
    }
    const rows = [...seen.values()];

    const { data: existing } = await supabase
      .from("catalog_products")
      .select("id, reference, label");
    const existingIndex = new Map<string, { id: string; label: string }>();
    for (const item of existing ?? []) {
      existingIndex.set(item.reference.toLowerCase(), { id: item.id, label: item.label });
    }

    const toInsert = rows.filter((row) => !existingIndex.has(row.reference.toLowerCase()));
    const toUpdate = rows.filter((row) => existingIndex.has(row.reference.toLowerCase()));

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
      const current = existingIndex.get(row.reference.toLowerCase())!;
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

    // Fill in any product still missing a semantic fingerprint
    const { data: missing } = await supabase
      .from("catalog_products")
      .select("id, label")
      .is("embedding", null)
      .limit(2000);
    for (const item of missing ?? []) {
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
          message: `${toInsert.length} ajoutés, ${toUpdate.length} mis à jour, ${embedded} indexés`,
        })
        .eq("id", run.id);
    }

    return { inserted: toInsert.length, updated: toUpdate.length, embedded };
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
