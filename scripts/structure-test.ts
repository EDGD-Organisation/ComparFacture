import fs from "node:fs";
import path from "node:path";
import { extractTextFromFile } from "../src/lib/ocr.server";
import { structureInvoiceText } from "../src/lib/structure.server";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex !== -1 ? args[outIndex + 1] : null;
const filePaths = args.filter((_, i) => outIndex === -1 || (i !== outIndex && i !== outIndex + 1));

if (filePaths.length === 0) {
  console.error(
    "Usage: bun run structure:test <facture1.pdf|.jpg|...> [facture2 ...] [--out resultats.json]",
  );
  process.exit(1);
}

type Result = {
  file: string;
  mime: string;
  pageCount: number;
  ocrDurationSeconds: number;
  structureDurationSeconds: number;
  text: string;
  structured?: unknown;
  error?: string;
};

const results: Result[] = [];

for (const filePath of filePaths) {
  if (!fs.existsSync(filePath)) {
    console.error(`Fichier introuvable : ${filePath}`);
    continue;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".pdf" ? "application/pdf" : `image/${ext.slice(1) || "png"}`;
  const buffer = fs.readFileSync(filePath);

  console.log(`\n=== ${filePath} ===`);

  const ocrStarted = Date.now();
  const { text, pageCount } = await extractTextFromFile(buffer.toString("base64"), mime);
  const ocrDurationSeconds = Number(((Date.now() - ocrStarted) / 1000).toFixed(1));
  console.log(`OCR: ${pageCount} page(s), ${ocrDurationSeconds}s, ${text.length} caractères`);

  const result: Result = {
    file: filePath,
    mime,
    pageCount,
    ocrDurationSeconds,
    text,
    structureDurationSeconds: 0,
  };

  const structureStarted = Date.now();
  try {
    const structured = await structureInvoiceText(text);
    result.structureDurationSeconds = Number(((Date.now() - structureStarted) / 1000).toFixed(1));
    result.structured = structured;
    console.log(`Structuration: ${result.structureDurationSeconds}s`);
    console.log(JSON.stringify(structured, null, 2));
  } catch (error) {
    result.structureDurationSeconds = Number(((Date.now() - structureStarted) / 1000).toFixed(1));
    result.error = error instanceof Error ? error.message : String(error);
    console.error("Structuration ÉCHOUÉE:", result.error);
  }

  results.push(result);
}

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nRésultats enregistrés dans ${outPath}`);
}

// The Tesseract worker keeps a background handle open for reuse across calls
// (desirable in the long-lived server); force-exit so this one-shot CLI run ends.
process.exit(0);
