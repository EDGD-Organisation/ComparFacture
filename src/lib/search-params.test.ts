import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, test } from "bun:test";

import { ALL, DEFAULT_FILTERS, paginate } from "./matching-view";
import {
  DEFAULT_COMPARATIF_SEARCH,
  DEFAULT_FACTURE_SEARCH,
  ETAPES,
  MAX_PAGE,
  MODES,
  backToComparatifSearch,
  canonicalizeComparatifSearch,
  etapeToTab,
  filtersFromSearch,
  parseComparatifSearch,
  parseFactureSearch,
  patchComparatifSearch,
  patchFactureSearch,
  searchPatchFromFilters,
  serializeComparatifSearch,
  serializeFactureSearch,
  tabToEtape,
  validateComparatifSearch,
  validateFactureSearch,
  withVue,
} from "./search-params";

/** Aller-retour réel : état -> URL (sérialiseur du routeur) -> lecture du routeur -> parseur. */
const throughUrl = (params: Record<string, unknown>) =>
  defaultParseSearch(defaultStringifySearch(params));

describe("parseComparatifSearch : valeurs par défaut et paramètres invalides", () => {
  test("aucun paramètre : tous les défauts", () => {
    expect(parseComparatifSearch({})).toEqual(DEFAULT_COMPARATIF_SEARCH);
  });

  test("entrée qui n'est pas un objet : défauts, sans erreur", () => {
    for (const raw of [undefined, null, "x", 12, [1, 2], true]) {
      expect(parseComparatifSearch(raw)).toEqual(DEFAULT_COMPARATIF_SEARCH);
    }
  });

  test("valeurs hors liste : défaut de chaque clé, les clés valides sont conservées", () => {
    const parsed = parseComparatifSearch({
      vue: "autre",
      etape: 3,
      statut: "inconnu",
      validation: { a: 1 },
      page: 4,
      q: "lait",
    });
    expect(parsed).toEqual({ ...DEFAULT_COMPARATIF_SEARCH, page: 4, q: "lait" });
  });

  test("valeurs valides conservées", () => {
    const state = {
      vue: "rapprochements",
      etape: "preferes",
      q: "beurre doux",
      statut: "review",
      facture: "abc-123",
      fournisseur: "Sysco France",
      validation: "unvalidated",
      page: 3,
    } as const;
    expect(parseComparatifSearch(state)).toEqual(state);
  });

  test("paramètres inconnus ignorés", () => {
    expect(parseComparatifSearch({ utm_source: "mail", foo: 1 })).toEqual(
      DEFAULT_COMPARATIF_SEARCH,
    );
  });

  test("facture et fournisseur vides, nulles ou illisibles : « tous »", () => {
    expect(parseComparatifSearch({ facture: "", fournisseur: null })).toEqual(
      DEFAULT_COMPARATIF_SEARCH,
    );
    expect(parseComparatifSearch({ facture: { a: 1 }, fournisseur: [1] })).toEqual(
      DEFAULT_COMPARATIF_SEARCH,
    );
  });

  test("q : nombre du routeur remis en texte, booléen ou objet ignorés", () => {
    expect(parseComparatifSearch({ q: 12 }).q).toBe("12");
    expect(parseComparatifSearch({ q: true }).q).toBe("");
    expect(parseComparatifSearch({ q: { a: 1 } }).q).toBe("");
    expect(parseComparatifSearch({ q: null }).q).toBe("");
  });
});

describe("page : négative, NaN, absurde, hors bornes", () => {
  const pageOf = (page: unknown) => parseComparatifSearch({ page }).page;

  test("entiers positifs lus tels quels, texte numérique accepté", () => {
    expect(pageOf(1)).toBe(1);
    expect(pageOf(7)).toBe(7);
    expect(pageOf("7")).toBe(7);
    expect(pageOf(MAX_PAGE)).toBe(MAX_PAGE);
  });

  test("zéro, négatif, NaN, infini, décimal, texte, vide, null : page 1", () => {
    for (const value of [0, -3, Number.NaN, Infinity, -Infinity, 2.5, "abc", "", null, undefined]) {
      expect(pageOf(value)).toBe(1);
    }
  });

  test("valeur absurde au-delà de la borne : page 1", () => {
    expect(pageOf(MAX_PAGE + 1)).toBe(1);
    expect(pageOf(1e12)).toBe(1);
  });

  test("page demandée au-delà du dernier numéro : la pagination retombe sur la dernière page", () => {
    const items = Array.from({ length: 120 }, (_, index) => index);
    const requested = pageOf(99);
    expect(requested).toBe(99);
    const shown = paginate(items, requested, 50);
    expect(shown.page).toBe(3);
    expect(shown.from).toBe(101);
    expect(shown.to).toBe(120);
    expect(shown.items).toHaveLength(20);
  });
});

describe("défauts omis de l'URL", () => {
  test("état par défaut : aucun paramètre", () => {
    expect(serializeComparatifSearch(DEFAULT_COMPARATIF_SEARCH)).toEqual({});
    expect(serializeFactureSearch(DEFAULT_FACTURE_SEARCH)).toEqual({});
  });

  test("seules les valeurs non par défaut sont écrites", () => {
    expect(
      serializeComparatifSearch({ ...DEFAULT_COMPARATIF_SEARCH, vue: "rapprochements", page: 2 }),
    ).toEqual({ vue: "rapprochements", page: 2 });
    expect(serializeFactureSearch({ ...DEFAULT_FACTURE_SEARCH, mode: "achat", q: "x" })).toEqual({
      mode: "achat",
      q: "x",
    });
  });

  test("validateSearch retire une valeur par défaut écrite à la main", () => {
    expect(validateComparatifSearch({ vue: "synthese", page: 1, statut: "all", q: "" })).toEqual(
      {},
    );
    expect(validateComparatifSearch({ vue: "rapprochements", page: 1 })).toEqual({
      vue: "rapprochements",
    });
    expect(validateFactureSearch({ mode: "recap", statut: "all" })).toEqual({});
  });

  test("validateSearch d'une URL abîmée : défauts, sans exception", () => {
    expect(validateComparatifSearch({ vue: ["a"], page: "zzz", etape: 9, q: {} })).toEqual({});
    expect(validateFactureSearch({ mode: "zzz", q: [], statut: 5 })).toEqual({});
  });
});

describe("aller-retour parse -> sérialise -> parse", () => {
  const states = [
    DEFAULT_COMPARATIF_SEARCH,
    { ...DEFAULT_COMPARATIF_SEARCH, vue: "rapprochements" as const },
    {
      vue: "rapprochements" as const,
      etape: "ozego" as const,
      q: "crème 35 % & co",
      statut: "unmatched" as const,
      facture: "9c1f2e7a-0000-4000-8000-000000000001",
      fournisseur: "Brake France",
      validation: "validated" as const,
      page: 12,
    },
  ];

  test("l'état se retrouve à l'identique", () => {
    for (const state of states) {
      expect(parseComparatifSearch(serializeComparatifSearch(state))).toEqual(state);
    }
  });

  test("à travers une vraie URL du routeur", () => {
    for (const state of states) {
      const viaUrl = throughUrl(serializeComparatifSearch(state));
      expect(parseComparatifSearch(viaUrl)).toEqual(state);
    }
  });

  test("page facture : état identique, directement et par l'URL", () => {
    for (const mode of MODES) {
      const state = { mode, q: "huile d'olive", statut: "unvalidated" as const };
      expect(parseFactureSearch(serializeFactureSearch(state))).toEqual(state);
      expect(parseFactureSearch(throughUrl(serializeFactureSearch(state)))).toEqual(state);
    }
    expect(parseFactureSearch({})).toEqual(DEFAULT_FACTURE_SEARCH);
  });
});

describe("q : caractères spéciaux", () => {
  const roundTrip = (q: string) => parseComparatifSearch(throughUrl({ q })).q;

  test("accents, espaces, esperluette, égal, dièse, pourcentage, plus, slash, guillemets", () => {
    const values = [
      "crème fraîche",
      "a & b = c",
      "100 % pur beurre",
      "#123",
      "a+b",
      "x/y\\z",
      'dit "bonjour"',
      "l'huile",
      " espaces autour ",
      "émoji 🧈",
      "?q=imbriqué&page=9",
    ];
    for (const value of values) expect(roundTrip(value)).toBe(value);
  });

  test("texte qui ressemble à du JSON ou à un nombre : reste du texte", () => {
    for (const value of ["12", "007", "1e3", "true", "null", "[1,2]", '{"a":1}', "-5", "0.5"]) {
      expect(roundTrip(value)).toBe(value);
    }
  });

  test("q vide : absent de l'URL", () => {
    expect(defaultStringifySearch(serializeComparatifSearch(DEFAULT_COMPARATIF_SEARCH))).toBe("");
    expect(
      defaultStringifySearch(serializeComparatifSearch({ ...DEFAULT_COMPARATIF_SEARCH, q: "" })),
    ).toBe("");
  });

  test("lien écrit à la main avec un nombre : relu comme texte", () => {
    expect(parseComparatifSearch(defaultParseSearch("?q=12&page=2"))).toEqual({
      ...DEFAULT_COMPARATIF_SEARCH,
      q: "12",
      page: 2,
    });
  });
});

describe("patchComparatifSearch / patchFactureSearch", () => {
  test("fusionne dans l'URL courante et omet les défauts", () => {
    const prev = { vue: "rapprochements", q: "lait", page: 3 };
    expect(patchComparatifSearch(prev, { page: 1 })).toEqual({ vue: "rapprochements", q: "lait" });
    expect(patchComparatifSearch(prev, { q: "" })).toEqual({ vue: "rapprochements", page: 3 });
    expect(patchComparatifSearch({}, {})).toEqual({});
  });

  test("URL courante abîmée : le patch s'applique sur les défauts", () => {
    expect(patchComparatifSearch({ page: "zz", vue: 4 }, { etape: "ozego" })).toEqual({
      etape: "ozego",
    });
    expect(patchFactureSearch(undefined, { mode: "achat" })).toEqual({ mode: "achat" });
    expect(patchFactureSearch({ mode: "achat", q: "x" }, { mode: "recap" })).toEqual({ q: "x" });
  });
});

describe("withVue", () => {
  const rapprochements = {
    ...DEFAULT_COMPARATIF_SEARCH,
    vue: "rapprochements" as const,
    etape: "ozego" as const,
    q: "lait",
    page: 4,
  };

  test("quitter les rapprochements remet sous-onglet, filtres et page à zéro", () => {
    expect(withVue(rapprochements, "synthese")).toEqual(DEFAULT_COMPARATIF_SEARCH);
    expect(serializeComparatifSearch(withVue(rapprochements, "synthese"))).toEqual({});
  });

  test("entrer dans les rapprochements garde le reste de l'URL", () => {
    expect(withVue({ ...DEFAULT_COMPARATIF_SEARCH, q: "x" }, "rapprochements")).toEqual({
      ...DEFAULT_COMPARATIF_SEARCH,
      q: "x",
      vue: "rapprochements",
    });
  });
});

describe("sous-onglets et filtres de la vue projet", () => {
  test("étape <-> onglet : bijection sur les quatre sous-onglets", () => {
    expect(ETAPES.map(etapeToTab)).toEqual(["general", "fournisseur", "ozego", "ozego-preferes"]);
    for (const etape of ETAPES) expect(tabToEtape(etapeToTab(etape))).toBe(etape);
  });

  test("filtersFromSearch : défauts = DEFAULT_FILTERS de la vue", () => {
    expect(filtersFromSearch(DEFAULT_COMPARATIF_SEARCH)).toEqual(DEFAULT_FILTERS);
  });

  test("filtersFromSearch lit chaque paramètre", () => {
    expect(
      filtersFromSearch({
        ...DEFAULT_COMPARATIF_SEARCH,
        q: "x",
        statut: "review",
        facture: "f1",
        fournisseur: "S",
        validation: "validated",
      }),
    ).toEqual({
      search: "x",
      status: "review",
      invoiceId: "f1",
      supplier: "S",
      validation: "validated",
    });
  });

  test("un changement de filtre ramène en page 1 et ne touche que sa clé", () => {
    expect(searchPatchFromFilters({ status: "review" })).toEqual({ statut: "review", page: 1 });
    expect(searchPatchFromFilters({ search: "a" })).toEqual({ q: "a", page: 1 });
    expect(searchPatchFromFilters({ invoiceId: ALL, supplier: "S" })).toEqual({
      facture: ALL,
      fournisseur: "S",
      page: 1,
    });
    expect(
      patchComparatifSearch(
        { vue: "rapprochements", page: 5 },
        searchPatchFromFilters({ validation: "validated" }),
      ),
    ).toEqual({ vue: "rapprochements", validation: "validated" });
  });
});

describe("canonicalizeComparatifSearch", () => {
  const known = { invoiceIds: ["f1", "f2"], suppliers: ["Sysco", "Brake"] };
  const base = { ...DEFAULT_COMPARATIF_SEARCH, vue: "rapprochements" as const };

  test("rien à corriger : même objet", () => {
    const search = { ...base, facture: "f1", fournisseur: "Sysco", page: 2 };
    expect(canonicalizeComparatifSearch(search, known, 2)).toBe(search);
    expect(canonicalizeComparatifSearch(base, known, 1)).toBe(base);
  });

  test("facture ou fournisseur inconnus : retour à « tous »", () => {
    const next = canonicalizeComparatifSearch(
      { ...base, facture: "disparue", fournisseur: "Inconnu", q: "lait" },
      known,
      1,
    );
    expect(next).toEqual({ ...base, q: "lait" });
  });

  test("page hors bornes : ramenée à la page réellement affichée", () => {
    expect(canonicalizeComparatifSearch({ ...base, page: 99 }, known, 3).page).toBe(3);
    expect(
      serializeComparatifSearch(canonicalizeComparatifSearch({ ...base, page: 99 }, known, 1)),
    ).toEqual({ vue: "rapprochements" });
  });
});

describe("backToComparatifSearch", () => {
  test("venu des rapprochements : rouvre cette vue", () => {
    expect(backToComparatifSearch({ fromVue: "rapprochements", __TSR_index: 3 })).toEqual({
      vue: "rapprochements",
    });
  });

  test("autre état, absent ou illisible : défaut", () => {
    expect(backToComparatifSearch({})).toEqual({});
    expect(backToComparatifSearch(undefined)).toEqual({});
    expect(backToComparatifSearch(null)).toEqual({});
    expect(backToComparatifSearch("rapprochements")).toEqual({});
    expect(backToComparatifSearch({ fromVue: "synthese" })).toEqual({});
  });
});
