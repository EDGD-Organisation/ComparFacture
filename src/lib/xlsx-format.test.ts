import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { euro, priceInput } from "./format";
import {
  formatPriceColumns,
  formatPriceRows,
  isPriceLabel,
  PRICE_NUMBER_FORMAT,
  rowOf,
} from "./xlsx-format";

const NBSP = new RegExp("[\u00a0\u202f]", "g");

describe("prix à 3 décimales", () => {
  test("euro affiche toujours 3 décimales", () => {
    expect(euro(12.5).replace(NBSP, " ")).toBe("12,500 €");
    expect(euro(0.0004).replace(NBSP, " ")).toBe("0,000 €");
    expect(euro(1234.5678).replace(NBSP, " ")).toBe("1 234,568 €");
    expect(euro(null)).toBe("—");
  });

  test("le champ de saisie d'un prix reprend les 3 décimales", () => {
    expect(priceInput(12.5)).toBe("12,500");
    expect(priceInput(null)).toBe("");
  });
});

describe("isPriceLabel", () => {
  const prices = [
    "PU facturé",
    "PU comparable",
    "[Tous fournisseurs] PU Ozego",
    "Total ligne facturé",
    "Total HT",
    "Écart unitaire",
    "Écart total",
    "Écart global",
    "Meilleur prix Ozego",
    "Facturé",
  ];
  const others = [
    "Écart %",
    "Écart global %",
    "Remise %",
    "Quantité",
    "N° ligne",
    "Lignes",
    "Coef. conditionnement",
    "Qté ramenée à l'unité",
    "Score de rapprochement",
    "Références du groupe",
    "Nombre de lignes",
    "Tolérance (%)",
  ];

  for (const label of prices) {
    test(`${label} est un prix`, () => expect(isPriceLabel(label)).toBe(true));
  }
  for (const label of others) {
    test(`${label} n'est pas un prix`, () => expect(isPriceLabel(label)).toBe(false));
  }
});

describe("formatPriceColumns / formatPriceRows", () => {
  test("seules les colonnes de prix reçoivent le format, les valeurs sont intactes", () => {
    const sheet = XLSX.utils.json_to_sheet([
      { Fournisseur: "Metro Total", Quantité: 3, "PU facturé": 1.23456, "Écart %": 4.5 },
    ]);
    formatPriceColumns(sheet);
    expect(sheet["C2"].z).toBe(PRICE_NUMBER_FORMAT);
    expect(sheet["C2"].v).toBe(1.23456);
    expect(sheet["B2"].z).toBeUndefined();
    expect(sheet["D2"].z).toBeUndefined();
  });

  test("les lignes « libellé | valeur » d'une synthèse", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Prospect", "Chez Marcel"],
      ["Total facturé", 100.5],
      ["Lignes hors tolérance", 4],
      ["Écart global %", 3.2],
    ]);
    formatPriceRows(sheet);
    expect(sheet["B2"].z).toBe(PRICE_NUMBER_FORMAT);
    expect(sheet["B3"].z).toBeUndefined();
    expect(sheet["B4"].z).toBeUndefined();
  });

  test("un tableau intégré à une synthèse se formate par son ligne d'en-têtes", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Total facturé", 10],
      [],
      ["Fournisseur", "Lignes", "Facturé"],
      ["Total Gaz", 4, 12.3456],
    ]);
    formatPriceColumns(sheet, 3);
    expect(sheet["C4"].z).toBe(PRICE_NUMBER_FORMAT);
    expect(sheet["B4"].z).toBeUndefined();
  });

  test("rowOf retrouve la ligne d'en-têtes d'un tableau intégré", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Total facturé", 10], [], ["Fournisseur", "Lignes"]]);
    expect(rowOf(sheet, "Fournisseur")).toBe(3);
    expect(rowOf(sheet, "Absent")).toBe(0);
  });

  test("les lignes de données ne sont pas lues comme des libellés quand fromRow les exclut", () => {
    const sheet = XLSX.utils.json_to_sheet([{ Fournisseur: "Metro Total", Quantité: 3 }]);
    formatPriceRows(sheet, 3);
    expect(sheet["B2"].z).toBeUndefined();
  });
});
