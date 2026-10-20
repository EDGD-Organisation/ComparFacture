import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import {
  IMAGE_PROMPT,
  normalizeInvoice,
  structureInvoiceImage,
  type ExtractedInvoice,
} from "../src/lib/structure.server";

// Compares the production extractor (Gemini) with Claude models on the same real invoice files,
// without touching Supabase or the app. There is no ground truth, so the main reliability signal
// is reconciliation: do the extracted line amounts add up to the invoice's printed total_ht?
// Prices are $/1M tokens (input, output) as of 2026-10; update if they change.
const CLAUDE_MODELS: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}
const outPath = flag("--out");
const modelsArg = flag("--models");
const skipGemini = args.includes("--no-gemini");
const effort = (flag("--effort") ?? "medium") as "low" | "medium" | "high";
const flagValues = new Set([outPath, modelsArg, flag("--effort")].filter(Boolean));
const filePaths = args.filter((a) => !a.startsWith("--") && !flagValues.has(a));
const models = modelsArg ? modelsArg.split(",") : Object.keys(CLAUDE_MODELS);

if (filePaths.length === 0) {
  console.error(
    "Usage: bun run scripts/compare-extraction.ts <facture.pdf|.jpg|...> [...] " +
      "[--models claude-haiku-5-5,claude-sonnet-5-5] [--effort low|medium|high] " +
      "[--no-gemini] [--out resultats.json]",
  );
  process.exit(1);
}
for (const m of models) {
  if (!CLAUDE_MODELS[m]) {
    console.error(`Modèle inconnu : ${m} (connus : ${Object.keys(CLAUDE_MODELS).join(", ")})`);
    process.exit(1);
  }
}
if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("ANTHROPIC_API_KEY manquante (à mettre dans .env, jamais dans le chat).");
  process.exit(1);
}

const nullable = (type: string) => ({ type: [type, "null"] });
const invoiceJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    supplier_name: nullable("string"),
    invoice_number: nullable("string"),
    invoice_date: nullable("string"),
    currency: { type: "string" },
    total_ht: nullable("number"),
    total_ttc: nullable("number"),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          supplier_reference: nullable("string"),
          label: { type: "string" },
          quantity: { type: "number" },
          unit: nullable("string"),
          unit_price: nullable("number"),
          discount_percent: nullable("number"),
          line_total: nullable("number"),
        },
        required: [
          "supplier_reference",
          "label",
          "quantity",
          "unit",
          "unit_price",
          "discount_percent",
          "line_total",
        ],
      },
    },
  },
  required: [
    "supplier_name",
    "invoice_number",
    "invoice_date",
    "currency",
    "total_ht",
    "total_ttc",
    "lines",
  ],
} as const;

const client = new Anthropic();

type ClaudeRun = { invoice: ExtractedInvoice; inputTokens: number; outputTokens: number };

async function extractWithClaude(model: string, base64: string, mime: string): Promise<ClaudeRun> {
  const source =
    mime === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: mime, data: base64 } } as const)
      : ({
          type: "image",
          source: {
            type: "base64",
            media_type: mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: base64,
          },
        } as const);

  const stream = client.messages.stream({
    model,
    max_tokens: 32000,
    output_config: { effort, format: { type: "json_schema", schema: invoiceJsonSchema } },
    messages: [{ role: "user", content: [source, { type: "text", text: IMAGE_PROMPT }] }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "max_tokens") throw new Error("Réponse tronquée (max_tokens)");
  if (message.stop_reason === "refusal") throw new Error("Refus du modèle");
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Réponse vide");
  return {
    invoice: normalizeInvoice(JSON.parse(text.text) as Record<string, unknown>),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

function mimeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return `image/${ext || "png"}`;
}

function linesSum(invoice: ExtractedInvoice): number {
  return invoice.lines.reduce((sum, l) => {
    if (l.line_total != null) return sum + l.line_total;
    if (l.unit_price != null)
      return sum + l.quantity * l.unit_price * (1 - (l.discount_percent ?? 0) / 100);
    return sum;
  }, 0);
}

type Row = {
  file: string;
  engine: string;
  seconds: number;
  lines?: number;
  sum?: number;
  totalHt?: number | null;
  reconcilePct?: number | null;
  cost?: number | null;
  error?: string;
  invoice?: ExtractedInvoice;
};

const rows: Row[] = [];

function describe(row: Row, invoice: ExtractedInvoice): Row {
  const sum = linesSum(invoice);
  return {
    ...row,
    lines: invoice.lines.length,
    sum: Number(sum.toFixed(2)),
    totalHt: invoice.total_ht,
    reconcilePct:
      invoice.total_ht == null || invoice.total_ht === 0
        ? null
        : Number((((sum - invoice.total_ht) / invoice.total_ht) * 100).toFixed(2)),
    invoice,
  };
}

for (const filePath of filePaths) {
  if (!fs.existsSync(filePath)) {
    console.error(`Fichier introuvable : ${filePath}`);
    continue;
  }
  const mime = mimeOf(filePath);
  const base64 = fs.readFileSync(filePath).toString("base64");
  const file = path.basename(filePath);
  console.log(`\n=== ${file} ===`);

  const engines: Array<{
    name: string;
    run: () => Promise<{ invoice: ExtractedInvoice; cost: number | null }>;
  }> = [];
  if (!skipGemini) {
    engines.push({
      name: "gemini-3.1-flash-lite",
      run: async () => {
        let usage = { inputTokens: 0, outputTokens: 0 };
        const invoice = await structureInvoiceImage(base64, mime, (u) => (usage = u));
        console.log(
          `  (gemini : ${usage.inputTokens} tokens en entrée, ${usage.outputTokens} en sortie)`,
        );
        return { invoice, cost: null };
      },
    });
  }
  for (const model of models) {
    engines.push({
      name: model,
      run: async () => {
        const r = await extractWithClaude(model, base64, mime);
        const p = CLAUDE_MODELS[model]!;
        const cost = (r.inputTokens * p.input + r.outputTokens * p.output) / 1_000_000;
        return { invoice: r.invoice, cost };
      },
    });
  }

  for (const engine of engines) {
    const started = Date.now();
    const base: Row = { file, engine: engine.name, seconds: 0 };
    try {
      const { invoice, cost } = await engine.run();
      base.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
      const row = describe(
        { ...base, cost: cost == null ? null : Number(cost.toFixed(4)) },
        invoice,
      );
      rows.push(row);
      console.log(
        `${engine.name.padEnd(24)} ${String(row.lines).padStart(3)} lignes  somme=${row.sum}  ` +
          `total_ht=${row.totalHt ?? "?"}  écart=${row.reconcilePct ?? "?"}%  ${base.seconds}s` +
          (row.cost != null ? `  ~$${row.cost}` : ""),
      );
    } catch (error) {
      base.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
      const message = error instanceof Error ? error.message : String(error);
      rows.push({ ...base, error: message });
      console.log(`${engine.name.padEnd(24)} ÉCHEC : ${message}`);
    }
  }
}

console.log("\n=== Résumé par moteur ===");
const engineNames = [...new Set(rows.map((r) => r.engine))];
for (const name of engineNames) {
  const mine = rows.filter((r) => r.engine === name);
  const ok = mine.filter((r) => !r.error);
  const checked = ok.filter((r) => r.reconcilePct != null);
  const exact = checked.filter((r) => Math.abs(r.reconcilePct!) <= 0.5).length;
  const totalCost = ok.reduce((s, r) => s + (r.cost ?? 0), 0);
  console.log(
    `${name.padEnd(24)} ${ok.length}/${mine.length} réussies · ` +
      `${exact}/${checked.length} réconcilient le total à ±0,5 % · ` +
      `${(ok.reduce((s, r) => s + r.seconds, 0) / Math.max(ok.length, 1)).toFixed(1)}s en moyenne` +
      (totalCost > 0 ? ` · coût total ~$${totalCost.toFixed(4)}` : ""),
  );
}

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf8");
  console.log(`\nDétail complet enregistré dans ${outPath}`);
}

process.exit(0);
