import fs from "node:fs";
import path from "node:path";
import { extractTextFromFile } from "../src/lib/ocr.server";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex !== -1 ? args[outIndex + 1] : null;
const filePaths = args.filter((_, i) => outIndex === -1 || (i !== outIndex && i !== outIndex + 1));

if (filePaths.length === 0) {
  console.error(
    "Usage: bun run ocr:test <facture1.pdf|.jpg|...> [facture2 ...] [--out resultats.json]",
  );
  process.exit(1);
}

type Result = {
  file: string;
  mime: string;
  pageCount: number;
  durationSeconds: number;
  text: string;
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
  const started = Date.now();
  const { text, pageCount } = await extractTextFromFile(buffer.toString("base64"), mime);
  const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(1));

  console.log(
    `\n--- ${filePath} (${pageCount} page${pageCount > 1 ? "s" : ""}, ${durationSeconds}s) ---\n`,
  );
  console.log(text || "(aucun texte détecté)");

  results.push({ file: filePath, mime, pageCount, durationSeconds, text });
}

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nRésultats enregistrés dans ${outPath}`);
}

// The Tesseract worker keeps a background handle open for reuse across calls
// (desirable in the long-lived server); force-exit so this one-shot CLI run ends.
process.exit(0);
