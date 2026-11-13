import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";

import { buildLbnWorkbook, type LbnInput, type LbnLine, type LbnProduct } from "./lbn-export";
import { LBN_SHEETS } from "./lbn-layout";

const template = readFileSync(new URL("../assets/lbn-template.xlsx", import.meta.url));

const product = (over: Partial<LbnProduct> = {}): LbnProduct => ({
  reference: "152023",
  name: "Boeuf Boulettes 70% VBF 30g",
  price: 8.93,
  unit: "KG",
  supplier: "PRO A PRO",
  family: "Boucherie",
  ozegoId: "5.6.74.1",
  genericId: "6.74.1",
  ...over,
});

const line = (over: Partial<LbnLine> = {}): LbnLine => ({
  date: "2026-10-01",
  supplier: "PRO A PRO",
  label: "Boulettes boeuf 30g 5K",
  reference: "152023",
  unit: "KG",
  unitPrice: 44.459,
  quantity: 14,
  packFactor: 5,
  product: product(),
  best: product({ reference: "27897", supplier: "SYSCO", price: 7.5 }),
  ...over,
});

async function build(lines: LbnLine[]) {
  const input: LbnInput = { title: "Client test", lines, exportDate: new Date("2026-11-12") };
  const workbook = await buildLbnWorkbook(template, input);
  const buffer = await workbook.xlsx.writeBuffer();
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(buffer as ArrayBuffer);
  return reread;
}

const formulaOf = (cell: ExcelJS.Cell) =>
  typeof cell.value === "object" && cell.value && "formula" in cell.value
    ? cell.value.formula
    : undefined;

describe("export au format LBN", () => {
  test("le modèle n'embarque aucune donnée client et garde les 3 feuilles", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      LBN_SHEETS.main,
      LBN_SHEETS.catalog,
      LBN_SHEETS.cheapest,
    ]);
    expect(workbook.getWorksheet(LBN_SHEETS.catalog)!.rowCount).toBe(1);
    expect(workbook.getWorksheet(LBN_SHEETS.main)!.getCell("C33").value).toBeNull();
  });

  test("une ligne : valeurs, formules de calcul et recherches vers les feuilles", async () => {
    const sheet = (await build([line()])).getWorksheet(LBN_SHEETS.main)!;
    // Prix et quantité ramenés à l'unité par le coefficient, comme « =44.459/5 » du fichier d'origine.
    expect(formulaOf(sheet.getCell("F32"))).toBe("44.459/5");
    expect(formulaOf(sheet.getCell("G32"))).toBe("14*5");
    expect(formulaOf(sheet.getCell("H32"))).toBe("G32*F32");
    expect(formulaOf(sheet.getCell("K32"))).toBe("D32");
    expect(formulaOf(sheet.getCell("J32"))).toContain("XLOOKUP($K32,'2026,10 OZ al'!C:C");
    expect(formulaOf(sheet.getCell("L32"))).toContain("'2026,10 OZ al'!D:D");
    expect(formulaOf(sheet.getCell("O32"))).toBe("(L32-F32)/F32");
    expect(formulaOf(sheet.getCell("P32"))).toBe("G32*L32");
    expect(formulaOf(sheet.getCell("R32"))).toContain("XLOOKUP(J32,'Prix le -cher'!B:B");
    expect(formulaOf(sheet.getCell("U32"))).toContain("'Prix le -cher'!D:D");
    expect(formulaOf(sheet.getCell("X32"))).toBe("(U32-F32)/F32");
    expect(formulaOf(sheet.getCell("Y32"))).toBe("U32*G32");
    expect(sheet.getCell("M32").value).toBe(5);
    // Valeurs en cache : lisibles sans recalcul.
    const h = sheet.getCell("H32").value as { result: number };
    expect(h.result).toBeCloseTo(14 * 44.459, 6);
    const x = sheet.getCell("X32").value as { result: number };
    expect(x.result).toBeCloseTo((7.5 - 44.459 / 5) / (44.459 / 5), 9);
  });

  test("les feuilles de recherche contiennent les produits utilisés", async () => {
    const workbook = await build([line()]);
    const catalog = workbook.getWorksheet(LBN_SHEETS.catalog)!;
    expect(catalog.getCell("A2").value).toBe("Boeuf Boulettes 70% VBF 30g");
    expect(catalog.getCell("C2").value).toBe("152023");
    expect(catalog.getCell("D2").value).toBe(8.93);
    expect(catalog.getCell("W2").value).toBe("5.6.74.1");
    const cheapest = workbook.getWorksheet(LBN_SHEETS.cheapest)!;
    expect(cheapest.getCell("B2").value).toBe("Boeuf Boulettes 70% VBF 30g");
    expect(cheapest.getCell("G2").value).toBe("27897");
    expect(cheapest.getCell("H2").value).toBe("SYSCO");
    expect(cheapest.getCell("D2").value).toBe(7.5);
  });

  test("totaux en formules, positionnés sous la dernière ligne", async () => {
    const sheet = (
      await build([
        line(),
        line({ reference: "9", product: product({ reference: "9", price: null }), best: null }),
      ])
    ).getWorksheet(LBN_SHEETS.main)!;
    // 2 lignes : 32 et 33, totaux en 35, 36, 37.
    expect(formulaOf(sheet.getCell("H35"))).toBe("SUM(H32:H33)");
    expect(formulaOf(sheet.getCell("P35"))).toBe("+SUM(P32:P33)");
    expect(formulaOf(sheet.getCell("Y35"))).toBe("+SUM(Y32:Y33)");
    expect(sheet.getCell("G35").value).toBe("TOTAL");
    // Seule la 1re ligne a un prix Ozego et une offre : la base de comparaison est celle de ces lignes.
    expect(formulaOf(sheet.getCell("M36"))).toBe("SUMPRODUCT(--ISNUMBER(P32:P33),H32:H33)");
    expect(formulaOf(sheet.getCell("P36"))).toBe("(P35-M36)/M36");
    expect(formulaOf(sheet.getCell("P37"))).toBe("P35-M36");
    expect(formulaOf(sheet.getCell("Y36"))).toContain("SUMPRODUCT(--ISNUMBER(Y32:Y33),H32:H33)");
    // Produit sans prix : « Hors Mercuriale », pas de calcul d'écart.
    expect(sheet.getCell("K33").value).toBe("Hors Mercuriale");
    expect(sheet.getCell("O33").value).toBeNull();
    expect(sheet.getCell("R33").value).toBeNull();
  });

  test("produits non référencés sous le bandeau, récurrence fournisseur et filtre", async () => {
    const workbook = await build([
      line(),
      line({
        product: null,
        best: null,
        label: "Abricots",
        reference: "366",
        unitPrice: 8.99,
        packFactor: 1,
      }),
    ]);
    const sheet = workbook.getWorksheet(LBN_SHEETS.main)!;
    // 1 ligne comparable : dernière ligne 32, totaux 34-36, bandeau 37, en-tête 39, produits dès 40.
    expect(sheet.getCell("B37").value).toBe("PRODUITS NON REFERENCES DANS NOTRE MERCURIALE");
    expect(sheet.getCell("C39").value).toBe("Désignation");
    expect(sheet.getCell("C40").value).toBe("Abricots");
    expect(sheet.getCell("F40").value).toBe(8.99);
    expect(sheet.getCell("T17").value).toBe("PRO A PRO");
    expect(sheet.getCell("T18").value).toBe("SYSCO");
    expect(formulaOf(sheet.getCell("U18"))).toBe("COUNTIF($T$32:$T$32,T18)");
    expect(formulaOf(sheet.getCell("U28"))).toBe("+SUM(U17:U27)");
    expect(sheet.autoFilter).toEqual("A31:Z32");
    expect(String(sheet.getCell("E3").value)).toContain("Client test - Comparatif alimentaire");
  });

  test("la mise en forme du modèle est conservée (rouge si négatif, logo, fusions, couleurs)", async () => {
    const sheet = (await build([line()])).getWorksheet(LBN_SHEETS.main)!;
    const conditional = (sheet as unknown as { conditionalFormattings: unknown[] })
      .conditionalFormattings;
    expect(conditional.length > 0).toBe(true);
    expect(sheet.getImages().length > 0).toBe(true);
    expect((sheet.getCell("A31").fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe(
      "FFE49EDD",
    );
    expect(sheet.getCell("O32").numFmt).toBe("0%");
    expect(sheet.getCell("F32").numFmt).toBe("0.000");
    expect(Object.keys((sheet as unknown as { _merges: object })._merges)).toContain("B37");
  });
});
