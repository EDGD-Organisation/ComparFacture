const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function apiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY manquante");
  return key;
}

async function gatewayFetch(path: string, body: unknown) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 402) {
      throw new Error("Crédits IA épuisés. Rechargez vos crédits Lovable pour continuer.");
    }
    if (res.status === 429) {
      throw new Error("Trop de requêtes IA en même temps. Réessayez dans quelques instants.");
    }
    throw new Error(`Erreur IA [${res.status}]: ${text}`);
  }
  return res.json();
}

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

const EXTRACTION_PROMPT = `Tu es un expert en lecture de factures fournisseurs.
Analyse le document fourni (facture, éventuellement scannée) et renvoie UNIQUEMENT un objet JSON valide, sans texte autour, sans balises markdown, au format:
{
  "supplier_name": string|null,
  "invoice_number": string|null,
  "invoice_date": "YYYY-MM-DD"|null,
  "currency": "EUR",
  "total_ht": number|null,
  "total_ttc": number|null,
  "lines": [
    {
      "supplier_reference": string|null,
      "label": string,
      "quantity": number,
      "unit": string|null,
      "unit_price": number|null,
      "discount_percent": number|null,
      "line_total": number|null
    }
  ]
}
Règles:
- Ne renvoie que les lignes de produits/prestations facturées, pas les totaux, frais de port compris uniquement s'ils apparaissent comme une ligne.
- Les nombres utilisent le point décimal, sans symbole monétaire ni séparateur de milliers.
- unit_price est le prix unitaire HT.
- Si une information est absente, mets null.`;

function contentBlockForFile(mime: string, base64: string, fileName: string) {
  if (mime.startsWith("image/")) {
    return { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } };
  }
  return {
    type: "file",
    file: { filename: fileName, file_data: `data:${mime};base64,${base64}` },
  };
}

function parseJsonLoose(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Réponse IA illisible");
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function extractInvoice(
  base64: string,
  mime: string,
  fileName: string,
): Promise<ExtractedInvoice> {
  const json = (await gatewayFetch("/chat/completions", {
    model: "google/gemini-3.7-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: EXTRACTION_PROMPT },
          contentBlockForFile(mime, base64, fileName),
        ],
      },
    ],
  })) as { choices?: Array<{ message?: { content?: string } }> };

  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonLoose(content) as Record<string, unknown>;
  const rawLines = Array.isArray(parsed["lines"])
    ? (parsed["lines"] as Record<string, unknown>[])
    : [];

  return {
    supplier_name: (parsed["supplier_name"] as string) ?? null,
    invoice_number: (parsed["invoice_number"] as string) ?? null,
    invoice_date: (parsed["invoice_date"] as string) ?? null,
    currency: (parsed["currency"] as string) ?? "EUR",
    total_ht: num(parsed["total_ht"]),
    total_ttc: num(parsed["total_ttc"]),
    lines: rawLines
      .filter(
        (line) => typeof line["label"] === "string" && (line["label"] as string).trim() !== "",
      )
      .map((line) => ({
        supplier_reference: (line["supplier_reference"] as string) ?? null,
        label: String(line["label"]).trim(),
        quantity: num(line["quantity"]) ?? 1,
        unit: (line["unit"] as string) ?? null,
        unit_price: num(line["unit_price"]),
        discount_percent: num(line["discount_percent"]),
        line_total: num(line["line_total"]),
      })),
  };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 4000) || " ");
    const json = (await gatewayFetch("/embeddings", {
      model: "openai/text-embedding-3-small",
      input: batch,
    })) as { data?: Array<{ index: number; embedding: number[] }> };
    const data = (json.data ?? []).slice().sort((a, b) => a.index - b.index);
    for (const item of data) out.push(item.embedding);
  }
  return out;
}
