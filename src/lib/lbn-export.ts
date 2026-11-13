import type ExcelJS from "exceljs";

import { LBN_FIRST_ROW, LBN_RECURRENCE_ROWS, LBN_SHEETS } from "./lbn-layout";

/**
 * Export final au format du fichier Excel « comparatif alimentaire » du client : on part du modèle
 * `src/assets/lbn-template.xlsx` (styles, logo, fusions, mise en forme conditionnelle d'origine) et on
 * écrit les lignes, les formules de calcul et les deux feuilles de recherche que les XLOOKUP du
 * fichier d'origine interrogent. Module pur (aucun accès à la base) : `lbn-input.ts` prépare les données.
 */

export type LbnProduct = {
  reference: string;
  name: string;
  price: number | null;
  unit: string | null;
  supplier: string | null;
  family: string | null;
  /** Identifiant Ozego complet de l'offre. */
  ozegoId: string | null;
  /** Identifiant Ozego générique (colonne « ID générique »). */
  genericId: string | null;
};

export type LbnLine = {
  /** Date de la facture, `AAAA-MM-JJ`. */
  date: string | null;
  supplier: string;
  label: string;
  reference: string;
  unit: string;
  unitPrice: number | null;
  quantity: number;
  /** Coefficient de conditionnement, déjà normalisé (1 par défaut). */
  packFactor: number;
  /** Produit du catalogue rapproché (bloc « Ozego même fournisseur »). */
  product: LbnProduct | null;
  /** Offre la moins chère du groupe Ozego (bloc « Alternative chez autre fournisseur le - cher »). */
  best: LbnProduct | null;
};

export type LbnInput = {
  title: string;
  lines: LbnLine[];
  exportDate: Date;
};

const SPACE = " ";
const HORS_MERCURIALE = "Hors Mercuriale";
const STYLE_COLUMNS = 26;

type Styles = Map<number, Partial<ExcelJS.Style>>;
type Cell = { value: ExcelJS.CellValue };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const quote = (name: string) => `'${name.replace(/'/g, "''")}'`;
const lookup = (key: string, sheet: string, keyColumn: string, resultColumn: string) =>
  `_xlfn.XLOOKUP(${key},${quote(sheet)}!${keyColumn}:${keyColumn},${quote(sheet)}!${resultColumn}:${resultColumn},"${SPACE}")`;

function excelDate(isoDate: string | null): Date | null {
  const match = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null;
}

/** Valeurs qui ne peuvent pas servir de clé de XLOOKUP : présentes plusieurs fois. */
function duplicates(values: string[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return repeated;
}

function textUnit(unit: string | null): string {
  // `unit` du catalogue vient parfois d'un champ numérique sans rapport avec l'unité de négo.
  const text = unit?.trim() ?? "";
  return text !== "" && Number.isNaN(Number(text.replace(",", "."))) ? text : SPACE;
}

function snapshot(sheet: ExcelJS.Worksheet, rows: number[]): Map<number, Styles> {
  const result = new Map<number, Styles>();
  for (const row of rows) {
    const styles: Styles = new Map();
    for (let column = 1; column <= STYLE_COLUMNS; column += 1) {
      styles.set(column, clone(sheet.getCell(row, column).style));
    }
    result.set(row, styles);
  }
  return result;
}

function applyRowStyle(
  sheet: ExcelJS.Worksheet,
  row: number,
  styles: Styles | undefined,
  height?: number,
) {
  if (!styles) return;
  for (const [column, style] of styles) sheet.getCell(row, column).style = clone(style);
  if (height) sheet.getRow(row).height = height;
}

function put(
  sheet: ExcelJS.Worksheet,
  address: string,
  formula: string | null,
  result: ExcelJS.CellValue,
) {
  const cell = sheet.getCell(address) as Cell;
  cell.value = formula ? { formula, result: result as never } : result;
}

type Prototypes = {
  line: Styles;
  lineOffer: Styles;
  total: Styles;
  percent: Styles;
  saving: Styles;
  banner: Styles;
  header: Styles;
  item: Styles;
  heights: { line: number; banner: number; header: number; item: number };
};

export async function buildLbnWorkbook(
  template: ArrayBuffer | Uint8Array,
  input: LbnInput,
): Promise<ExcelJS.Workbook> {
  const { default: ExcelJSModule } = await import("exceljs");
  const workbook = new ExcelJSModule.Workbook();
  await workbook.xlsx.load(template as ArrayBuffer);

  const main = workbook.getWorksheet(LBN_SHEETS.main);
  const catalog = workbook.getWorksheet(LBN_SHEETS.catalog);
  const cheapest = workbook.getWorksheet(LBN_SHEETS.cheapest);
  if (!main || !catalog || !cheapest) throw new Error("Modèle d'export invalide");

  // Lignes comparables (produit rapproché avec un PU facturé) puis les autres : « non référencés ».
  const comparable = input.lines
    .filter((line) => line.product !== null && line.unitPrice !== null)
    .sort((a, b) => b.quantity * (b.unitPrice ?? 0) - a.quantity * (a.unitPrice ?? 0));
  const others = input.lines.filter((line) => !comparable.includes(line));

  const last = Math.max(LBN_FIRST_ROW + comparable.length - 1, LBN_FIRST_ROW);
  const totalRow = last + 2;
  const percentRow = totalRow + 1;
  const savingRow = totalRow + 2;
  const bannerRow = totalRow + 3;
  const headerRow = totalRow + 5;
  const itemFirst = totalRow + 6;

  // Prototypes de style pris dans le modèle, puis zone des lignes remise à zéro.
  const snapshots = snapshot(main, [33, 34, 123, 124, 125, 126, 128, 129]);
  const proto: Prototypes = {
    line: snapshots.get(34)!,
    lineOffer: snapshots.get(33)!,
    total: snapshots.get(123)!,
    percent: snapshots.get(124)!,
    saving: snapshots.get(125)!,
    banner: snapshots.get(126)!,
    header: snapshots.get(128)!,
    item: snapshots.get(129)!,
    heights: {
      line: main.getRow(34).height ?? 15,
      banner: main.getRow(126).height ?? 47.5,
      header: main.getRow(128).height ?? 42.5,
      item: main.getRow(129).height ?? 14.5,
    },
  };
  try {
    main.unMergeCells("B126:Q126");
  } catch {
    // déjà défusionnée
  }
  for (let row = LBN_FIRST_ROW; row <= Math.max(main.rowCount, 200); row += 1) {
    const target = main.getRow(row);
    target.height = undefined as unknown as number;
    for (let column = 1; column <= STYLE_COLUMNS; column += 1) {
      const cell = main.getCell(row, column);
      cell.value = null;
      cell.style = {};
    }
  }

  // --- Feuilles de recherche -------------------------------------------------------------------
  const products = new Map<string, LbnProduct>();
  for (const line of comparable)
    products.set(`${line.product!.reference}|${line.product!.name}`, line.product!);
  const catalogRows = [...products.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const catalogRefDuplicates = duplicates(catalogRows.map((product) => product.reference));

  const offers = new Map<string, LbnProduct>();
  for (const line of comparable) {
    if (line.best && line.best.price !== null) {
      offers.set(`${line.best.name}|${line.best.reference}`, line.best);
    }
  }
  const cheapestRows = [...offers.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const offerRefDuplicates = duplicates(cheapestRows.map((offer) => offer.reference));

  catalog.getCell("D1").value = `Prix ${input.exportDate.toLocaleDateString("fr-FR")}`;
  catalogRows.forEach((product, index) => {
    const row = index + 2;
    catalog.getCell(`A${row}`).value = product.name;
    catalog.getCell(`B${row}`).value = product.name;
    catalog.getCell(`C${row}`).value = product.reference;
    catalog.getCell(`D${row}`).value = product.price;
    catalog.getCell(`F${row}`).value = product.supplier;
    catalog.getCell(`G${row}`).value = textUnit(product.unit);
    catalog.getCell(`H${row}`).value = product.family;
    catalog.getCell(`W${row}`).value = product.ozegoId;
    catalog.getCell(`X${row}`).value = product.genericId;
  });
  cheapestRows.forEach((offer, index) => {
    const row = index + 2;
    cheapest.getCell(`A${row}`).value = offer.genericId;
    cheapest.getCell(`B${row}`).value = offer.name;
    cheapest.getCell(`C${row}`).value = offer.name;
    cheapest.getCell(`D${row}`).value = offer.price;
    cheapest.getCell(`E${row}`).value = textUnit(offer.unit);
    cheapest.getCell(`G${row}`).value = offer.reference;
    cheapest.getCell(`H${row}`).value = offer.supplier;
  });
  // Une même offre pour plusieurs lignes est normale (une seule ligne de recherche) : seul un même
  // nom de produit avec des références différentes rendrait le XLOOKUP par nom ambigu.
  const ambiguousOfferNames = new Set<string>();
  const nameToReference = new Map<string, Set<string>>();
  for (const offer of offers.values()) {
    const refs = nameToReference.get(offer.name) ?? new Set<string>();
    refs.add(offer.reference);
    nameToReference.set(offer.name, refs);
  }
  for (const [name, refs] of nameToReference) if (refs.size > 1) ambiguousOfferNames.add(name);

  // --- Lignes « Achats clients » ---------------------------------------------------------------
  const productPriced = (line: LbnLine) => line.product!.price !== null;
  let invoicedTotal = 0;
  let ozegoTotal = 0;
  let offerTotal = 0;
  let invoicedWithOzego = 0;
  let invoicedWithOffer = 0;
  let offerLines = 0;
  const offerSupplierCount = new Map<string, number>();

  comparable.forEach((line, index) => {
    const row = LBN_FIRST_ROW + index;
    const product = line.product!;
    const k = line.packFactor;
    const unitPrice = line.unitPrice!;
    const comparablePrice = unitPrice / k;
    const comparableQuantity = line.quantity * k;
    const ca = comparableQuantity * comparablePrice;
    invoicedTotal += ca;

    const priced = productPriced(line);
    applyRowStyle(main, row, proto.line, proto.heights.line);
    if (!priced) {
      for (const column of [10, 11])
        main.getCell(row, column).style = clone(proto.lineOffer.get(column)!);
    }

    put(main, `A${row}`, null, excelDate(line.date));
    put(main, `B${row}`, null, line.supplier);
    put(main, `C${row}`, null, line.label);
    put(main, `D${row}`, null, line.reference === "" ? null : line.reference);
    put(main, `E${row}`, null, line.unit);
    put(
      main,
      `F${row}`,
      k === 1 ? null : `${unitPrice}/${k}`,
      k === 1 ? unitPrice : comparablePrice,
    );
    put(
      main,
      `G${row}`,
      k === 1 ? null : `${line.quantity}*${k}`,
      k === 1 ? line.quantity : comparableQuantity,
    );
    put(main, `H${row}`, `G${row}*F${row}`, ca);

    // Bloc « Ozego même fournisseur » : produit du catalogue rapproché par référence.
    const referenceSame = product.reference === line.reference && line.reference !== "";
    const ambiguous = catalogRefDuplicates.has(product.reference);
    put(
      main,
      `K${row}`,
      priced && referenceSame ? `D${row}` : null,
      priced ? product.reference : HORS_MERCURIALE,
    );
    const key = `$K${row}`;
    const viaSheet = priced && !ambiguous;
    put(main, `J${row}`, viaSheet ? lookup(key, LBN_SHEETS.catalog, "C", "A") : null, product.name);
    put(
      main,
      `L${row}`,
      viaSheet ? lookup(key, LBN_SHEETS.catalog, "C", "D") : null,
      priced ? product.price : SPACE,
    );
    put(main, `M${row}`, null, priced ? k : SPACE);
    put(
      main,
      `N${row}`,
      viaSheet ? lookup(key, LBN_SHEETS.catalog, "C", "G") : null,
      priced ? textUnit(product.unit) : SPACE,
    );
    if (priced) {
      const ozegoPrice = product.price!;
      put(
        main,
        `O${row}`,
        `(L${row}-F${row})/F${row}`,
        (ozegoPrice - comparablePrice) / comparablePrice,
      );
      put(main, `P${row}`, `G${row}*L${row}`, comparableQuantity * ozegoPrice);
      ozegoTotal += comparableQuantity * ozegoPrice;
      invoicedWithOzego += ca;
    }

    // Bloc « Alternative chez autre fournisseur le - cher ».
    const best = line.best;
    if (best && best.price !== null) {
      const viaOffers =
        !offerRefDuplicates.has(best.reference) && !ambiguousOfferNames.has(best.name);
      const nameKey = `J${row}`;
      const refKey = `$R${row}`;
      put(
        main,
        `R${row}`,
        viaOffers ? lookup(nameKey, LBN_SHEETS.cheapest, "B", "G") : null,
        best.reference,
      );
      put(
        main,
        `S${row}`,
        viaOffers ? lookup(refKey, LBN_SHEETS.cheapest, "G", "C") : null,
        best.name,
      );
      put(
        main,
        `T${row}`,
        viaOffers ? lookup(refKey, LBN_SHEETS.cheapest, "G", "H") : null,
        best.supplier ?? SPACE,
      );
      put(
        main,
        `U${row}`,
        viaOffers ? lookup(refKey, LBN_SHEETS.cheapest, "G", "D") : null,
        best.price,
      );
      put(main, `V${row}`, null, k);
      put(
        main,
        `W${row}`,
        viaOffers ? lookup(refKey, LBN_SHEETS.cheapest, "G", "E") : null,
        textUnit(best.unit),
      );
      put(
        main,
        `X${row}`,
        `(U${row}-F${row})/F${row}`,
        (best.price - comparablePrice) / comparablePrice,
      );
      put(main, `Y${row}`, `U${row}*G${row}`, best.price * comparableQuantity);
      offerTotal += best.price * comparableQuantity;
      invoicedWithOffer += ca;
      offerLines += 1;
      const supplier = best.supplier ?? SPACE;
      offerSupplierCount.set(supplier, (offerSupplierCount.get(supplier) ?? 0) + 1);
    }
  });

  // --- Totaux ----------------------------------------------------------------------------------
  const range = (column: string) => `${column}${LBN_FIRST_ROW}:${column}${last}`;
  const sameCa = (column: string) => `SUMPRODUCT(--ISNUMBER(${range(column)}),${range("H")})`;
  applyRowStyle(main, totalRow, proto.total, proto.heights.line);
  put(main, `G${totalRow}`, null, "TOTAL");
  put(main, `H${totalRow}`, `SUM(${range("H")})`, invoicedTotal);
  put(main, `O${totalRow}`, null, "TOTAL");
  put(main, `P${totalRow}`, `+SUM(${range("P")})`, ozegoTotal);
  put(main, `X${totalRow}`, null, "TOTAL");
  put(main, `Y${totalRow}`, `+SUM(${range("Y")})`, offerTotal);

  applyRowStyle(main, percentRow, proto.percent);
  applyRowStyle(main, savingRow, proto.saving);
  // Référence du bloc du milieu : CA du client sur les seules lignes qui ont un prix Ozego (dans
  // le fichier d'origine, une valeur saisie à la main).
  put(main, `M${percentRow}`, sameCa("P"), invoicedWithOzego);
  if (invoicedWithOzego > 0) {
    put(
      main,
      `P${percentRow}`,
      `(P${totalRow}-M${percentRow})/M${percentRow}`,
      (ozegoTotal - invoicedWithOzego) / invoicedWithOzego,
    );
  }
  put(main, `P${savingRow}`, `P${totalRow}-M${percentRow}`, ozegoTotal - invoicedWithOzego);
  const everyLineHasOffer = offerLines === comparable.length;
  const offerBase = everyLineHasOffer ? `H${totalRow}` : sameCa("Y");
  if (invoicedWithOffer > 0) {
    put(
      main,
      `Y${percentRow}`,
      `+(Y${totalRow}-${offerBase})/${offerBase}`,
      (offerTotal - invoicedWithOffer) / invoicedWithOffer,
    );
  }
  put(main, `Y${savingRow}`, `+Y${totalRow}-${offerBase}`, offerTotal - invoicedWithOffer);

  // --- Produits non référencés -------------------------------------------------------------------
  applyRowStyle(main, bannerRow, proto.banner, proto.heights.banner);
  put(main, `B${bannerRow}`, null, "PRODUITS NON REFERENCES DANS NOTRE MERCURIALE");
  main.mergeCells(`B${bannerRow}:Q${bannerRow}`);
  applyRowStyle(main, headerRow, proto.header, proto.heights.header);
  ["Date", "Fournisseur", "Désignation", "Référence", "Unité négo", "Prix unitaire"].forEach(
    (title, index) => {
      main.getCell(headerRow, index + 1).value = title;
    },
  );
  others.forEach((line, index) => {
    const row = itemFirst + index;
    const k = line.packFactor;
    applyRowStyle(main, row, proto.item, proto.heights.item);
    put(main, `A${row}`, null, excelDate(line.date));
    put(main, `B${row}`, null, line.supplier);
    put(main, `C${row}`, null, line.label);
    put(main, `D${row}`, null, line.reference === "" ? null : line.reference);
    put(main, `E${row}`, null, line.unit);
    if (line.unitPrice !== null) {
      put(main, `F${row}`, k === 1 ? null : `${line.unitPrice}/${k}`, line.unitPrice / k);
    }
  });

  // --- Titre, récurrence fournisseur, filtre ------------------------------------------------------
  const clientSuppliers = [...new Set(input.lines.map((line) => line.supplier))];
  const clientLabel =
    clientSuppliers.length > 3
      ? `${clientSuppliers.slice(0, 3).join(", ")}…`
      : clientSuppliers.join(", ");
  main.getCell("E3").value =
    `${input.title} - Comparatif alimentaire${clientLabel ? ` (${clientLabel})` : ""}`;

  const clientCount = new Map<string, number>();
  for (const line of input.lines)
    clientCount.set(line.supplier, (clientCount.get(line.supplier) ?? 0) + 1);
  const mainClient = [...clientCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const others2 = [...offerSupplierCount.entries()]
    .filter(([supplier]) => supplier !== mainClient)
    .sort((a, b) => b[1] - a[1]);
  const slots = LBN_RECURRENCE_ROWS.last - LBN_RECURRENCE_ROWS.first + 1;
  const names: Array<{ name: string; count: number; rest?: boolean }> = [];
  if (mainClient) names.push({ name: mainClient, count: offerSupplierCount.get(mainClient) ?? 0 });
  names.push(...others2.map(([name, count]) => ({ name, count })));
  const shown = names.slice(0, slots);
  if (names.length > slots) {
    const hidden = names.slice(slots - 1);
    shown.splice(slots - 1, 1, {
      name: "AUTRES",
      count: hidden.reduce((sum, item) => sum + item.count, 0),
      rest: true,
    });
  }
  const recurrenceTotal = shown.reduce((sum, item) => sum + item.count, 0);
  shown.forEach((item, index) => {
    const row = LBN_RECURRENCE_ROWS.first + index;
    put(main, `T${row}`, null, item.name);
    put(
      main,
      `U${row}`,
      item.rest
        ? `COUNTA($T$${LBN_FIRST_ROW}:$T$${last})-SUM(U${LBN_RECURRENCE_ROWS.first}:U${row - 1})`
        : `COUNTIF($T$${LBN_FIRST_ROW}:$T$${last},T${row})`,
      item.count,
    );
    if (recurrenceTotal > 0) {
      put(main, `V${row}`, `U${row}/$U$${LBN_RECURRENCE_ROWS.total}`, item.count / recurrenceTotal);
    }
  });
  put(
    main,
    `U${LBN_RECURRENCE_ROWS.total}`,
    `+SUM(U${LBN_RECURRENCE_ROWS.first}:U${LBN_RECURRENCE_ROWS.last})`,
    recurrenceTotal,
  );

  main.autoFilter = `A${LBN_FIRST_ROW - 1}:Z${last}`;
  main.views = [{ state: "normal", zoomScale: 100, activeCell: "A1" }];
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook;
}
