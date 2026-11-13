/**
 * Fabrique le modèle `src/assets/lbn-template.xlsx` de l'export final à partir du fichier Excel du
 * client (« comparatif alimentaire ») : mêmes styles, logo, fusions, mise en forme conditionnelle et
 * en-têtes, mais SANS aucune donnée client (le dépôt est public).
 *
 *   bun scripts/build-lbn-template.ts "<chemin du fichier client>.xlsx"
 *
 * Le fichier client n'est jamais copié dans le dépôt : seul le modèle nettoyé l'est.
 */
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";

import { LBN_SHEETS } from "../src/lib/lbn-layout";

const [source] = process.argv.slice(2);
if (!source) {
  console.error('Usage : bun scripts/build-lbn-template.ts "<fichier client>.xlsx"');
  process.exit(1);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(source);

const main = workbook.getWorksheet(LBN_SHEETS.main);
const catalog = workbook.getWorksheet(LBN_SHEETS.catalog);
const cheapest = workbook.getWorksheet(LBN_SHEETS.cheapest);
if (!main || !catalog || !cheapest) {
  throw new Error(
    `Feuilles attendues : « ${LBN_SHEETS.main} », « ${LBN_SHEETS.catalog} », « ${LBN_SHEETS.cheapest} ».`,
  );
}

// Feuilles masquées de saisie manuelle par fournisseur : hors modèle.
for (const sheet of [...workbook.worksheets]) {
  if (sheet.state === "hidden") workbook.removeWorksheet(sheet.id);
}

/** Vide les valeurs d'une zone en gardant les styles (les lignes servent de prototypes de style). */
function clearValues(sheet: ExcelJS.Worksheet, fromRow: number) {
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < fromRow) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.value = null;
    });
  });
}

// Feuille principale : titre, tableau de récurrence et lignes sont réécrits à chaque export.
clearValues(main, 32);
main.getCell("E3").value = "Client - Comparatif alimentaire";
for (let row = 17; row <= 27; row += 1) {
  for (const column of ["T", "U", "V"]) main.getCell(`${column}${row}`).value = null;
}
main.getCell("U28").value = null;
main.getCell("AA20").value = null;
main.autoFilter = undefined as unknown as ExcelJS.AutoFilter;
main.views = [{ state: "normal", zoomScale: 100, activeCell: "A1" }];

// Feuilles de recherche : seuls l'en-tête (ligne 1), les largeurs et la couleur d'onglet sont gardés.
// `spliceRows` laisserait les ~10 000 lignes dans le fichier : on recrée la feuille.
function recreateWithHeader(sheet: ExcelJS.Worksheet): ExcelJS.Worksheet {
  const header = sheet.getRow(1);
  const cells = header.model?.cells ?? [];
  const captured = cells.map((cell) => {
    const source = sheet.getCell(cell.address);
    return { address: cell.address, value: source.value, style: source.style };
  });
  const widths = sheet.columns.map((column) => column.width);
  const { name, properties } = sheet;
  const height = header.height;
  workbook.removeWorksheet(sheet.id);
  const fresh = workbook.addWorksheet(name, { properties, views: [{ state: "normal" }] });
  captured.forEach(({ address, value, style }) => {
    const target = fresh.getCell(address);
    target.value = value;
    target.style = style;
  });
  widths.forEach((width, index) => {
    if (width) fresh.getColumn(index + 1).width = width;
  });
  if (height) fresh.getRow(1).height = height;
  fresh.views = [{ state: "frozen", ySplit: 1 }];
  return fresh;
}
recreateWithHeader(catalog);
recreateWithHeader(cheapest);

// Les plages de filtre des feuilles supprimées ne doivent pas survivre dans le classeur.
(workbook.definedNames as unknown as { model: unknown[] }).model = [];

workbook.creator = "ComparFacture";
workbook.lastModifiedBy = "ComparFacture";
workbook.title = "Comparatif alimentaire";

await workbook.xlsx.writeFile(
  fileURLToPath(new URL("../src/assets/lbn-template.xlsx", import.meta.url)),
);
console.log("Modèle écrit : src/assets/lbn-template.xlsx");
