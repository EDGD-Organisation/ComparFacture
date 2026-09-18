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

// Forme renvoyée par GET /produits/comparatif (oze-back) : des groupes par identifiant
// Ozego, chacun portant plusieurs offres fournisseur, plus une pagination à parcourir.
// Une offre d'un groupe = une ligne "produit" une fois aplatie pour catalog_products.
type ComparatifOffer = {
  supplier?: { supplier_name?: string | null } | null;
  supplier_ref?: string | null;
  prix_nego?: string | number | null;
  // `weight` est le nom de colonne côté oze-back pour l'unité de négo (ex. "KG",
  // "PCE", "L", "PAIRE", "LE CENT") — absente de l'API jusqu'au 2026-09-18, ajoutée
  // depuis. Ne pas confondre avec `order_unit` : c'est un champ distinct côté
  // oze-back (le conditionnement d'achat — carton/barquette/bidon/etc., et
  // observé avec des valeurs incohérentes, parfois un nombre au lieu d'un code
  // d'unité) qui ne correspond pas à l'unité de négo malgré son nom trompeur.
  weight?: string | null;
};
type ComparatifGroup = { ozego_id?: string | null; product_name?: string | null; offers?: unknown };

function isComparatifPayload(
  payload: unknown,
): payload is { data: ComparatifGroup[]; pagination?: { totalPages?: number } } {
  const data = (payload as { data?: unknown } | null)?.data;
  return (
    Array.isArray(data) && data.length > 0 && Array.isArray((data[0] as ComparatifGroup)?.offers)
  );
}

function flattenComparatifGroups(groups: ComparatifGroup[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const group of groups) {
    const offers = Array.isArray(group.offers) ? (group.offers as ComparatifOffer[]) : [];
    for (const offer of offers) {
      rows.push({
        reference: offer.supplier_ref,
        label: group.product_name,
        price: offer.prix_nego,
        ozego_id: group.ozego_id,
        supplier_name: offer.supplier?.supplier_name ?? null,
        unit: offer.weight ?? null,
      });
    }
  }
  return rows;
}

async function fetchJson(url: string, apiKey: string | null) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`L'API du catalogue a répondu ${response.status}`);
  }
  return (await response.json()) as unknown;
}

export const syncCatalogFromErp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SyncInput.parse(input))
  .handler(async ({ data }) => {
    let url = data.url;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: settings }, { data: secrets }] = await Promise.all([
      supabaseAdmin.from("app_settings").select("erp_api_url").maybeSingle(),
      supabaseAdmin.from("app_secrets").select("erp_api_key").maybeSingle(),
    ]);
    if (!url) url = settings?.erp_api_url ?? undefined;
    const apiKey = secrets?.erp_api_key ?? null;
    if (!url) {
      throw new Error("Aucune URL d'API catalogue configurée dans les réglages");
    }

    // limit=1000 dès la 1ère page : sinon la 1ère page part sur le défaut de l'API
    // (20), ce qui désynchronise totalPages du reste de la boucle et multiplie par
    // ~50 le nombre de requêtes nécessaires pour tout parcourir.
    const firstUrl = new URL(url);
    firstUrl.searchParams.set("page", "1");
    firstUrl.searchParams.set("limit", "1000");
    const firstPayload = await fetchJson(firstUrl.toString(), apiKey);

    let list: unknown[];
    if (isComparatifPayload(firstPayload)) {
      // Comparatif Ozego : paginé, à parcourir en entier avant l'import.
      const rows = flattenComparatifGroups(firstPayload.data);
      const totalPages = firstPayload.pagination?.totalPages ?? 1;
      for (let page = 2; page <= totalPages; page += 1) {
        const pageUrl = new URL(url);
        pageUrl.searchParams.set("page", String(page));
        pageUrl.searchParams.set("limit", "1000");
        const payload = await fetchJson(pageUrl.toString(), apiKey);
        if (isComparatifPayload(payload)) rows.push(...flattenComparatifGroups(payload.data));
      }
      list = rows;
    } else {
      const payload = firstPayload;
      list = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { data?: unknown }).data)
          ? ((payload as { data: unknown[] }).data as unknown[])
          : Array.isArray((payload as { products?: unknown }).products)
            ? ((payload as { products: unknown[] }).products as unknown[])
            : [];
    }

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

// erp_api_key never reaches the browser: it lives in app_secrets (service-role only,
// see the migration). The settings page only ever learns whether a key is configured,
// never its value, and can only replace it — not read it back.
export const getErpApiKeyStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_secrets").select("erp_api_key").maybeSingle();
  return { configured: Boolean(data?.erp_api_key) };
});

const SaveApiKeyInput = z.object({ apiKey: z.string().min(1) });

export const saveErpApiKey = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SaveApiKeyInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_secrets")
      .upsert({ id: true, erp_api_key: data.apiKey });
    if (error) throw new Error(error.message);
    return { saved: true };
  });
