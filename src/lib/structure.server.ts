import { GoogleGenAI, Type, type Schema } from "@google/genai";

export type ExtractedLine = {
  supplier_reference: string | null;
  label: string;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  discount_percent: number | null;
  line_total: number | null;
};

export type ExtractedInvoice = {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string;
  total_ht: number | null;
  total_ttc: number | null;
  lines: ExtractedLine[];
};

// Flash-Lite: cheapest current Gemini tier. Handles this fixed-schema
// extraction fine even reading the image/PDF directly (measured ~$0.0014
// per invoice across real test files).
const MODEL = "gemini-3.1-flash-lite";

const lineSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    supplier_reference: { type: Type.STRING, nullable: true },
    label: { type: Type.STRING },
    quantity: { type: Type.NUMBER },
    unit: { type: Type.STRING, nullable: true },
    unit_price: { type: Type.NUMBER, nullable: true },
    discount_percent: { type: Type.NUMBER, nullable: true },
    line_total: { type: Type.NUMBER, nullable: true },
  },
  required: ["label", "quantity"],
};

const invoiceSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    supplier_name: { type: Type.STRING, nullable: true },
    invoice_number: { type: Type.STRING, nullable: true },
    invoice_date: { type: Type.STRING, nullable: true },
    currency: { type: Type.STRING },
    total_ht: { type: Type.NUMBER, nullable: true },
    total_ttc: { type: Type.NUMBER, nullable: true },
    lines: { type: Type.ARRAY, items: lineSchema },
  },
  required: ["currency", "lines"],
};

function apiKey(): string {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("GEMINI_API_KEY manquante");
  return key;
}

const IMAGE_PROMPT = `Tu es un expert en lecture de factures fournisseurs françaises.
Analyse le document (image) fourni et renvoie les données structurées de la facture.
Règles :
- Ne renvoie que les lignes de produits/prestations facturées, pas les totaux ni les lignes parasites.
- N'omets aucune ligne de produit visible sur le document, même si un chiffre est difficile à lire.
- Les nombres utilisent le point décimal, sans symbole monétaire ni séparateur de milliers.
- unit_price est le prix unitaire HT.
- line_total doit correspondre à la valeur IMPRIMÉE dans la colonne "Montant HT" (ou équivalent)
  de la ligne — utilise toujours cette valeur imprimée par défaut.
- Certaines factures ont des annotations manuscrites (souvent au stylo rouge) à côté des
  montants imprimés. Ce ne sont PAS forcément des corrections du montant à payer — privilégie
  systématiquement le montant imprimé, et n'utilise une annotation manuscrite que si le montant
  imprimé correspondant est totalement illisible ou absent.
- invoice_date doit être au format ISO "YYYY-MM-DD" (jamais "JJ.MM.AAAA", "JJ/MM/AAAA" ni aucun
  autre format) — convertis le format vu sur le document vers ce format.
- Si une information est absente ou illisible, mets null plutôt que d'inventer une valeur.`;

// The schema only requires `label`/`quantity` (and `currency`/`lines` at the
// top level) — every other field is legal for Gemini to omit entirely rather
// than send as `null`. Normalize here so callers always get `null`, matching
// ExtractedLine/ExtractedInvoice's types exactly.
function normalizeLine(raw: Record<string, unknown>): ExtractedLine {
  return {
    supplier_reference: (raw["supplier_reference"] as string) ?? null,
    label: raw["label"] as string,
    quantity: raw["quantity"] as number,
    unit: (raw["unit"] as string) ?? null,
    unit_price: (raw["unit_price"] as number) ?? null,
    discount_percent: (raw["discount_percent"] as number) ?? null,
    line_total: (raw["line_total"] as number) ?? null,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Belt-and-suspenders: the prompt asks for ISO dates, but LLMs don't always
// comply (observed "28.05.2026" in practice) — a non-ISO string written to
// the invoices.invoice_date DATE column fails the whole update statement
// with no partial write, silently leaving the invoice stuck at "processing".
function normalizeDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

function normalizeInvoice(raw: Record<string, unknown>): ExtractedInvoice {
  const rawLines = Array.isArray(raw["lines"]) ? (raw["lines"] as Record<string, unknown>[]) : [];
  return {
    supplier_name: (raw["supplier_name"] as string) ?? null,
    invoice_number: (raw["invoice_number"] as string) ?? null,
    invoice_date: normalizeDate(raw["invoice_date"]),
    currency: (raw["currency"] as string) ?? "EUR",
    total_ht: (raw["total_ht"] as number) ?? null,
    total_ttc: (raw["total_ttc"] as number) ?? null,
    lines: rawLines.map(normalizeLine),
  };
}

/**
 * Sends the invoice file (image or PDF) directly to Gemini's vision input.
 * This is the sole extraction path — an earlier OCR-text-then-LLM pipeline
 * (Tesseract → text → Gemini) was tried and dropped: it lost entire line
 * items on dense tables and couldn't distinguish printed from handwritten
 * numbers, since Tesseract flattens both into indistinguishable text. Reading
 * the image directly preserves that visual information. Verified against 7
 * real invoices: line-item sums reconcile to the printed total_ht within
 * 0.0% on every file where a total was present to check against.
 */
export async function structureInvoiceImage(
  base64: string,
  mimeType: string,
): Promise<ExtractedInvoice> {
  const client = new GoogleGenAI({ apiKey: apiKey() });
  const response = await client.models.generateContent({
    model: MODEL,
    contents: [{ text: IMAGE_PROMPT }, { inlineData: { data: base64, mimeType } }],
    config: {
      responseMimeType: "application/json",
      responseSchema: invoiceSchema,
    },
  });
  if (!response.text) throw new Error("Réponse IA vide");
  return normalizeInvoice(JSON.parse(response.text) as Record<string, unknown>);
}
