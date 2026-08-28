import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { ExtractedInvoice } from "./ai.server";

// Flash-Lite: cheapest current Gemini tier, meant for exactly this kind of
// high-throughput, fixed-schema text extraction (no image/PDF input here —
// that's the "3.7-flash" multimodal call in ai.server.ts, which stays as-is).
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

const SYSTEM_PROMPT = `Tu es un expert en lecture de factures fournisseurs françaises.
On te fournit le texte brut extrait par OCR (Tesseract) d'une facture — le texte peut
contenir du bruit : colonnes de tableau mal alignées, caractères mal reconnus, lignes
parasites (autres documents visibles sur la photo, annotations manuscrites). Reconstruis
du mieux possible les données structurées de la facture.
Règles :
- Ne renvoie que les lignes de produits/prestations facturées, pas les totaux ni les lignes parasites.
- Les nombres utilisent le point décimal, sans symbole monétaire ni séparateur de milliers.
- unit_price est le prix unitaire HT.
- N'omets aucune ligne de produit, même si son prix ou sa quantité sont difficiles à lire —
  mets les champs incertains à null plutôt que de sauter la ligne entière.
- Certains bordereaux (ex. Pomona/PassionFroid) ont DEUX colonnes de quantité par ligne :
  une quantité de conditionnement livré (ex. "Qté livrée" en COL/PLQ/COF/BQT) ET une quantité
  facturée dans une autre unité (ex. "Qté fact." en KG/L/PU/POT). C'est TOUJOURS la quantité
  facturée (celle associée à l'unité de facturation "UF") qu'il faut utiliser comme quantity,
  jamais la quantité de conditionnement livré — sinon quantity × unit_price ne correspondra
  pas au montant réel de la ligne.
- Vérifie ton travail : quantity × unit_price doit être égal (à l'arrondi près) au montant HT
  de la ligne (souvent la dernière colonne du tableau, ex. "Montant HT" ou "MT HT" — la colonne
  généralement la plus lisible car en bord de tableau, moins souvent recouverte d'annotations
  manuscrites). Si ce n'est pas le cas, cherche une autre paire quantité/prix dans le texte OCR
  qui vérifie cette égalité avant de répondre. Remplis toujours line_total avec ce montant HT
  de ligne quand il est visible — il sert d'ancre fiable même si quantity ou unit_price restent
  incertains.
- Si une information est absente ou illisible, mets null plutôt que d'inventer une valeur.`;

/**
 * Turns Tesseract's raw OCR text into the same structured shape `extractInvoice`
 * (ai.server.ts, multimodal Gemini call) produces — so callers can use either
 * extraction path interchangeably. Text-only input: OCR already did the "reading"
 * step, this only does the "understanding" step.
 */
export async function structureInvoiceText(ocrText: string): Promise<ExtractedInvoice> {
  const client = new GoogleGenAI({ apiKey: apiKey() });
  const response = await client.models.generateContent({
    model: MODEL,
    contents: ocrText,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: invoiceSchema,
    },
  });
  if (!response.text) throw new Error("Réponse IA vide");
  return JSON.parse(response.text) as ExtractedInvoice;
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
- Si une information est absente ou illisible, mets null plutôt que d'inventer une valeur.`;

/**
 * Sends the invoice file (image or scanned PDF page) directly to Gemini's
 * vision input instead of going through Tesseract OCR first. Unlike the OCR
 * text path, this preserves layout and ink-color information (printed vs.
 * handwritten), which matters on documents with handwritten price
 * annotations — the OCR text path was observed losing entire line items on
 * dense tables and conflating printed/handwritten numbers into one blob.
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
  return JSON.parse(response.text) as ExtractedInvoice;
}
