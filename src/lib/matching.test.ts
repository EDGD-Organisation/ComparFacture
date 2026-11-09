import { describe, expect, mock, test } from "bun:test";

// Seules les dépendances d'E/S sont simulées : le vrai matchLines tourne contre un faux client
// Supabase en mémoire (catalogue ci-dessous), sans embeddings.
type CatalogRow = {
  id: string;
  reference: string;
  ean: string | null;
  supplier_name: string | null;
  label: string;
  price: number;
};

type MappingRow = {
  supplier_name: string | null;
  supplier_reference: string | null;
  supplier_label: string | null;
  product_id: string;
  pack_factor: number;
};

let catalog: CatalogRow[] = [];
let mappings: MappingRow[] = [];
let failingTable: string | null = null;

// Comme PostgREST : un select non paginé ne renvoie jamais plus de 1000 lignes.
const SERVER_MAX_ROWS = 1000;

type Rows = { data: unknown; error: { message: string } | null; count?: number };
type Query = {
  select(columns: string, options?: { head?: boolean }): Query;
  eq(): Query;
  not(): Query;
  order(column: string): Query;
  range(from: number, to: number): Query;
  then(resolve: (rows: Rows) => unknown): unknown;
};

function fakeSupabase() {
  return {
    from(table: string): Query {
      let head = false;
      let ordered = false;
      let window: [number, number] | null = null;
      const query: Query = {
        select(_columns, options) {
          head = options?.head === true;
          return query;
        },
        eq: () => query,
        not: () => query,
        order() {
          ordered = true;
          return query;
        },
        range(from, to) {
          window = [from, to];
          return query;
        },
        then(resolve) {
          if (table === failingTable) {
            return resolve({ data: null, error: { message: `lecture ${table} refusée` } });
          }
          if (head) return resolve({ data: null, error: null, count: 0 });
          if (window && !ordered) {
            return resolve({ data: null, error: { message: "range sans order" } });
          }
          const rows = table === "product_mappings" ? mappings : catalog;
          const [from, to] = window ?? [0, SERVER_MAX_ROWS - 1];
          const end = Math.min(to, from + SERVER_MAX_ROWS - 1);
          return resolve({ data: rows.slice(from, end + 1), error: null });
        },
      };
      return query;
    },
    // Repli libellé : le trigramme est simulé par un score lexical fixe sur tout le périmètre.
    rpc(name: string, args: { supplier_names?: string[]; max_results?: number }) {
      if (name !== "search_catalog") return Promise.resolve({ data: [] });
      const names = args.supplier_names;
      const rows = catalog
        .filter((p) => !names || (p.supplier_name !== null && names.includes(p.supplier_name)))
        .slice(0, args.max_results)
        .map((p) => ({ id: p.id, label: p.label, price: p.price, score: 0.8 }));
      return Promise.resolve({ data: rows });
    },
  };
}

mock.module("./db.server", () => ({ serverSupabase: () => fakeSupabase() }));
mock.module("./embeddings.server", () => ({ embedTexts: async () => [] }));

const { matchLines } = await import("./matching.server");

const THRESHOLDS = { autoConfirm: 0.9, review: 0.6 };

const product = (
  id: string,
  supplier: string,
  reference: string,
  label = "Oignons cubes 2,5Kg",
): CatalogRow => ({ id, reference, ean: null, supplier_name: supplier, label, price: 9 });

async function matchOne(
  products: CatalogRow[],
  invoiceSupplier: string | null,
  reference: string | null,
  label: string,
  scope: string[] = [],
) {
  catalog = products;
  mappings = [];
  failingTable = null;
  const [result] = await matchLines(
    [{ supplier_reference: reference, label, unit: "KG", unit_price: 10 }],
    invoiceSupplier,
    THRESHOLDS,
    scope,
  );
  return result!;
}

describe("matchLines : étape référence", () => {
  test("(a) nom facture 'SYSCO FRANCE SAS' et référence '123-456' retrouvent SYSCO / 123456", async () => {
    const r = await matchOne(
      [product("p1", "SYSCO", "123456")],
      "SYSCO FRANCE SAS",
      "123-456",
      "Oignons cubes 2,5Kg",
    );
    expect(r.matched_product_id).toBe("p1");
    expect(r.match_method).toBe("reference");
    expect(r.match_score).toBe(1);
    expect(r.match_status).toBe("confirmed");
  });

  test("(b) même référence chez SYSCO et FRANCE FRAIS : le produit du fournisseur de la facture", async () => {
    const r = await matchOne(
      [
        product("ff", "FRANCE FRAIS", "60118", "Oignons cubes 2,5Kg"),
        product("sy", "SYSCO", "60118", "Oignons cubes 2,5Kg"),
      ],
      "SYSCO France",
      "60118",
      "Oignons cubes 2,5Kg",
    );
    expect(r.matched_product_id).toBe("sy");
    expect(r.match_method).toBe("reference");
  });

  test("(c) référence présente seulement chez un autre fournisseur : pas de rapprochement par référence", async () => {
    const r = await matchOne(
      [product("ff", "FRANCE FRAIS", "60118")],
      "SYSCO France",
      "60118",
      "Oignons cubes 2,5Kg",
    );
    expect(r.match_method).not.toBe("reference");
  });

  test("(d) deux produits, même fournisseur, même référence : le libellé désigne Chaource, pas Époisse", async () => {
    const r = await matchOne(
      [
        product("epoisse", "SYSCO", "190016", "Epoisse BIO 250g"),
        product("chaource", "SYSCO", "190016", "Chaource AOP 250g"),
      ],
      "SYSCO",
      "190016",
      "Chaource AOP 250g",
    );
    expect(r.matched_product_id).toBe("chaource");
    expect(r.match_method).toBe("reference");
  });

  test("(e) deux produits, même référence, libellé ambigu : pas de validation par référence", async () => {
    const r = await matchOne(
      [
        product("epoisse", "SYSCO", "190016", "Epoisse BIO 250g"),
        product("chaource", "SYSCO", "190016", "Chaource AOP 250g"),
      ],
      "SYSCO",
      "190016",
      "Fromage 250g",
    );
    expect(r.match_method).not.toBe("reference");
  });

  test("(f) bonne référence mais libellé sans aucun mot commun : pas de reference/confirmed", async () => {
    const r = await matchOne(
      [product("farfalle", "PRO A PRO", "13293", "Pâtes Farfalle 5Kg")],
      "PRO A PRO",
      "13293",
      "Polenta fine 1K",
    );
    expect(r.match_method).not.toBe("reference");
  });

  test("(g) périmètre restreint à un fournisseur : jamais de produit hors périmètre", async () => {
    const products = [
      product("sy", "SYSCO", "60118"),
      product("ff", "FRANCE FRAIS", "60118"),
      product("pf", "POMONA PASSION FROID", "60118"),
    ];
    const inScope = await matchOne(products, "SYSCO", "60118", "Oignons cubes 2,5Kg", ["SYSCO"]);
    expect(inScope.matched_product_id).toBe("sy");
    expect(inScope.match_method).toBe("reference");

    const outOfScope = await matchOne(products, "PassionFroid", "60118", "Oignons cubes 2,5Kg", [
      "SYSCO",
    ]);
    expect(outOfScope.match_method).not.toBe("reference");
    expect(outOfScope.matched_product_id).not.toBe("pf");
    expect(outOfScope.matched_product_id).not.toBe("ff");
  });

  test("(h) référence < 3 caractères, ligne de service, null et vide : sans plantage ni référence", async () => {
    const short = await matchOne(
      [product("p1", "SYSCO", "42")],
      "SYSCO",
      "42",
      "Oignons cubes 2,5Kg",
    );
    expect(short.match_method).not.toBe("reference");

    const service = await matchOne(
      [product("p1", "SYSCO", "123456")],
      "SYSCO",
      "123456",
      "Frais de livraison",
    );
    expect(service.matched_product_id).toBeNull();

    for (const reference of [null, ""]) {
      const r = await matchOne(
        [product("p1", "SYSCO", "123456")],
        "SYSCO",
        reference,
        "Oignons cubes 2,5Kg",
      );
      expect(r.match_method).not.toBe("reference");
    }

    const noSupplier = await matchOne(
      [product("p1", "SYSCO", "123456")],
      null,
      "123456",
      "Oignons cubes 2,5Kg",
    );
    expect(noSupplier.match_method).not.toBe("reference");
  });

  test("(i) régression : noms déjà identiques ('PRO A PRO') rapprochés par référence", async () => {
    const r = await matchOne(
      [product("p1", "PRO A PRO", "AB-123")],
      "PRO A PRO",
      "ab 123",
      "Oignons cubes 2,5Kg",
    );
    expect(r.matched_product_id).toBe("p1");
    expect(r.match_method).toBe("reference");
    expect(r.match_status).toBe("confirmed");
  });

  test("EAN : reste global, indépendant du fournisseur de la facture", async () => {
    const withEan: CatalogRow = {
      ...product("p1", "TRANSGOURMET", "ZZ999"),
      ean: "3017620422003",
    };
    const r = await matchOne([withEan], "SYSCO", "3017620422003", "Pâte à tartiner 1Kg");
    expect(r.matched_product_id).toBe("p1");
    expect(r.match_method).toBe("reference");
  });
});

describe("matchLines : lecture complète du catalogue et des mappings (plafond PostgREST de 1000)", () => {
  const filler = (count: number, supplier = "AUTRE"): CatalogRow[] =>
    Array.from({ length: count }, (_, i) => ({
      ...product(`f${i}`, supplier, `F${i}`, `Article ${i}`),
      ean: null,
    }));

  const mapping = (productId: string, reference: string): MappingRow => ({
    supplier_name: "SYSCO",
    supplier_reference: reference,
    supplier_label: null,
    product_id: productId,
    pack_factor: 1,
  });

  test("(a) produit au-delà de la 1000e ligne du catalogue : rapproché par référence", async () => {
    const r = await matchOne(
      [...filler(2000), product("cible", "SYSCO", "987654")],
      "SYSCO",
      "987654",
      "Oignons cubes 2,5Kg",
    );
    expect(r.matched_product_id).toBe("cible");
    expect(r.match_method).toBe("reference");
    expect(r.match_status).toBe("confirmed");
  });

  test("(b) mode restreint : mapping et produit au-delà de la 1000e ligne sont bien utilisés", async () => {
    catalog = [...filler(1500), product("cible", "SYSCO", "987654")];
    mappings = [
      ...Array.from({ length: 1200 }, (_, i) => mapping(`f${i}`, `AUTRE-${i}`)),
      mapping("cible", "MEM-77"),
    ];
    failingTable = null;
    const [r] = await matchLines(
      [{ supplier_reference: "MEM-77", label: "Oignons cubes 2,5Kg", unit: "KG", unit_price: 10 }],
      "SYSCO",
      THRESHOLDS,
      ["SYSCO"],
    );
    expect(r!.matched_product_id).toBe("cible");
    expect(r!.match_method).toBe("mapping");
    expect(r!.match_status).toBe("confirmed");
  });

  test("(c) mapping vers un produit hors périmètre : ignoré en mode restreint, utilisé sinon", async () => {
    const products = [
      product("sy", "SYSCO", "60118", "Oignons cubes 2,5Kg"),
      product("ff", "FRANCE FRAIS", "ZZ999", "Chou rouge 5Kg"),
    ];
    const line = {
      supplier_reference: "MEM-1",
      label: "Oignons cubes 2,5Kg",
      unit: "KG",
      unit_price: 10,
    };
    catalog = products;
    mappings = [mapping("ff", "MEM-1")];
    failingTable = null;

    const [restricted] = await matchLines([line], "SYSCO", THRESHOLDS, ["SYSCO"]);
    expect(restricted!.match_method).not.toBe("mapping");
    expect(restricted!.matched_product_id).not.toBe("ff");

    const [open] = await matchLines([line], "SYSCO", THRESHOLDS, []);
    expect(open!.matched_product_id).toBe("ff");
    expect(open!.match_method).toBe("mapping");
  });

  for (const table of ["product_mappings", "catalog_products"]) {
    test(`une erreur de lecture de ${table} est levée, jamais avalée`, async () => {
      catalog = [product("p1", "SYSCO", "123456")];
      mappings = [];
      failingTable = table;
      let message = "";
      try {
        await matchLines(
          [{ supplier_reference: "123456", label: "Oignons", unit: "KG", unit_price: 10 }],
          "SYSCO",
          THRESHOLDS,
        );
      } catch (error) {
        message = (error as Error).message;
      }
      failingTable = null;
      expect(message).toBe(`lecture ${table} refusée`);
    });
  }
});
