import fs from "node:fs";
import path from "node:path";
import { structureInvoiceImage } from "../src/lib/structure.server";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex !== -1 ? args[outIndex + 1] : null;
const filePaths = args.filter((_, i) => outIndex === -1 || (i !== outIndex && i !== outIndex + 1));

if (filePaths.length === 0) {
  console.error(
    "Usage: bun run multimodal:test <facture1.pdf|.jpg|...> [facture2 ...] [--out resultats.json]",
  );
  process.exit(1);
}

type Result = {
  file: string;
  mime: string;
  durationSeconds: number;
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
  const started = Date.now();
  try {
    const structured = await structureInvoiceImage(buffer.toString("base64"), mime);
    const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
    console.log(`(${durationSeconds}s)`);
    console.log(JSON.stringify(structured, null, 2));
    results.push({ file: filePath, mime, durationSeconds, structured });
  } catch (error) {
    const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
    const message = error instanceof Error ? error.message : String(error);
    console.error("ÉCHOUÉ:", message);
    results.push({ file: filePath, mime, durationSeconds, error: message });
  }
}

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nRésultats enregistrés dans ${outPath}`);
}

process.exit(0);
