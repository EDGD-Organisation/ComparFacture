import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ProductInput = z.object({
  reference: z.string().min(1),
  label: z.string().min(1),
  ean: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  family: z.string().nullable().optional(),
  ozego_id: z.string().nullable().optional(),
  supplier_name: z.string().nullable().optional(),
});

const ImportInput = z.object({
  products: z.array(ProductInput).min(1),
  source: z.string().default("import"),
});

export const importCatalog = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ImportInput.parse(input))
  .handler(async ({ data }) => {
    const { runCatalogImport } = await import("./catalog.server");
    return runCatalogImport(data);
  });

const SyncInput = z.object({ url: z.string().url().optional() }).default({});

export const syncCatalogFromErp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SyncInput.parse(input))
  .handler(async ({ data }) => {
    let url = data.url;
    if (!url) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: settings } = await supabaseAdmin
        .from("app_settings")
        .select("erp_api_url")
        .maybeSingle();
      url = settings?.erp_api_url ?? undefined;
    }
    if (!url) {
      throw new Error("Aucune URL d'API catalogue configurée dans les réglages");
    }
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`L'API du catalogue a répondu ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown }).data)
        ? ((payload as { data: unknown[] }).data as unknown[])
        : Array.isArray((payload as { products?: unknown }).products)
          ? ((payload as { products: unknown[] }).products as unknown[])
          : [];

    if (list.length === 0) throw new Error("Aucun produit trouvé dans la réponse de l'API");

    const pick = (row: Record<string, unknown>, keys: string[]) => {
      for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") return value;
      }
      return null;
    };

    const products = list
      .map((raw) => {
        const row = raw as Record<string, unknown>;
        const reference = pick(row, ["reference", "ref", "sku", "code", "product_code", "id"]);
        const label = pick(row, [
          "label",
          "name",
          "designation",
          "libelle",
          "title",
          "description",
        ]);
        if (!reference || !label) return null;
        const price = pick(row, ["price", "prix", "unit_price", "pu", "amount"]);
        return {
          reference: String(reference),
          label: String(label),
          ean: pick(row, ["ean", "gencod", "barcode"])
            ? String(pick(row, ["ean", "gencod", "barcode"]))
            : null,
          price: price === null ? null : Number(String(price).replace(",", ".")),
          unit: pick(row, ["unit", "unite", "uom"])
            ? String(pick(row, ["unit", "unite", "uom"]))
            : null,
          family: pick(row, ["family", "famille", "category", "categorie"])
            ? String(pick(row, ["family", "famille", "category", "categorie"]))
            : null,
          ozego_id: pick(row, [
            "ozego_id",
            "ozego",
            "id_ozego",
            "identifiant_ozego",
            "ozegoId",
            "group_id",
          ])
            ? String(
                pick(row, [
                  "ozego_id",
                  "ozego",
                  "id_ozego",
                  "identifiant_ozego",
                  "ozegoId",
                  "group_id",
                ]),
              )
            : null,
          supplier_name: pick(row, ["supplier", "supplier_name", "fournisseur", "vendor", "marque"])
            ? String(pick(row, ["supplier", "supplier_name", "fournisseur", "vendor", "marque"]))
            : null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((item) => ({
        ...item,
        price: Number.isFinite(item.price as number) ? item.price : null,
      }));

    if (products.length === 0)
      throw new Error("Impossible de reconnaître les champs produits de l'API");

    const { runCatalogImport } = await import("./catalog.server");
    return runCatalogImport({ products, source: "erp" });
  });
