import { embedTexts } from "./embeddings.server";
import { DEFAULT_PACK_FACTOR, normalizePackFactor } from "./pack";
import { serverSupabase } from "./db.server";
import { fetchAllRows } from "./paginate";
import { resolveByReference, type RefCandidate } from "./supplier-match";
import {
  isNonProductLine,
  normalizeLabel,
  priceScore,
  sizeScore,
  tokenScore,
} from "./match-normalize";

export type MatchResult = {
  matched_product_id: string | null;
  match_score: number | null;
  match_method: string | null;
  match_status: "confirmed" | "review" | "unmatched";
  pack_factor: number;
};

export type Thresholds = { autoConfirm: number; review: number };

export type MatchLineInput = {
  supplier_reference: string | null;
  label: string;
  unit?: string | null;
  unit_price?: number | null;
};

type Candidate = {
  id: string;
  label: string;
  price: number | null;
  lexical: number;
  semantic: number;
};

function statusFor(score: number, t: Thresholds): MatchResult["match_status"] {
  if (score >= t.autoConfirm) return "confirmed";
  if (score >= t.review) return "review";
  return "unmatched";
}

function normalizeRef(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function matchLines(
  lines: MatchLineInput[],
  supplierName: string | null,
  thresholds: Thresholds,
  scopeSuppliers: string[] = [],
): Promise<MatchResult[]> {
  const scoped = scopeSuppliers.length > 0;
  const supabase = serverSupabase();
  const results: MatchResult[] = lines.map(() => ({
    matched_product_id: null,
    match_score: null,
    match_method: null,
    match_status: "unmatched" as const,
    pack_factor: 1,
  }));

  // PostgREST plafonne chaque réponse à 1000 lignes : lecture complète par tranches ordonnées.
  const mappings = await fetchAllRows(() =>
    supabase
      .from("product_mappings")
      .select("supplier_name, supplier_reference, supplier_label, product_id, pack_factor")
      .order("id"),
  );

  // Comparatif restreint à certains fournisseurs : seuls leurs produits peuvent être rattachés.
  const products = await fetchAllRows(() =>
    supabase
      .from("catalog_products")
      .select("id, reference, ean, label, supplier_name")
      .eq("is_active", true)
      .order("id"),
  );
  const scopeSet = new Set(scopeSuppliers);
  const allowedIds = new Set<string>();
  for (const p of products) {
    if (!scoped || (p.supplier_name && scopeSet.has(p.supplier_name))) {
      allowedIds.add(p.id);
    }
  }

  const supplierKey = (supplierName ?? "").toLowerCase();
  const exactMappings = new Map<string, { product_id: string; pack_factor: number }>();
  const fuzzyMappings: Array<{ label: string; product_id: string; pack_factor: number }> = [];
  for (const m of mappings) {
    if (scoped && !allowedIds.has(m.product_id)) continue;
    const name = (m.supplier_name ?? "").toLowerCase();
    const value = { product_id: m.product_id, pack_factor: normalizePackFactor(m.pack_factor) };
    exactMappings.set(
      `${name}::${(m.supplier_reference ?? m.supplier_label ?? "").toLowerCase()}`,
      value,
    );
    if (name === supplierKey || !name || !supplierKey) {
      if (m.supplier_label) fuzzyMappings.push({ label: m.supplier_label, ...value });
    }
  }

  // Index références / EAN du catalogue (une seule lecture).
  // Une même référence peut désigner plusieurs produits (deux fournisseurs, voire un même
  // fournisseur) : refIndex garde tous les porteurs sans écrasement, et le fournisseur est
  // départagé à la recherche par sameSupplier, car le nom lu sur la facture diffère presque
  // toujours du nom ERP. eanIndex reste global, un EAN identifie le même produit physique
  // quel que soit le fournisseur qui le vend.
  const refIndex = new Map<string, RefCandidate[]>();
  const eanIndex = new Map<string, string>();
  for (const p of products) {
    if (!allowedIds.has(p.id)) continue;
    const key = normalizeRef(p.reference);
    if (key) {
      const entry: RefCandidate = { id: p.id, supplier_name: p.supplier_name, label: p.label };
      const list = refIndex.get(key);
      if (list) list.push(entry);
      else refIndex.set(key, [entry]);
    }
    if (p.ean) eanIndex.set(normalizeRef(p.ean), p.id);
  }

  const pending: number[] = [];

  lines.forEach((line, index) => {
    // Conditionnement : toujours 1 à l'import (le client le saisit à la main sur chaque ligne). Plus
    // aucune déduction depuis le libellé (« x6 », « carton de 12 »...) : elle imposait des valeurs
    // que personne n'avait saisies. Seule une correspondance mémorisée (ci-dessous) rapporte la
    // valeur déjà saisie pour ce produit.
    results[index]!.pack_factor = DEFAULT_PACK_FACTOR;

    // Lignes de service : jamais rapprochées
    if (isNonProductLine(line.label)) return;

    // 1. Correspondance mémorisée (exacte puis approchée sur le libellé)
    const mapped =
      exactMappings.get(
        `${supplierKey}::${(line.supplier_reference ?? line.label).toLowerCase()}`,
      ) ?? exactMappings.get(`${supplierKey}::${line.label.toLowerCase()}`);
    const fuzzy = mapped ?? fuzzyMappings.find((m) => tokenScore(line.label, m.label) >= 0.9);
    if (fuzzy) {
      results[index] = {
        matched_product_id: fuzzy.product_id,
        match_score: 1,
        match_method: "mapping",
        match_status: "confirmed",
        pack_factor: fuzzy.pack_factor,
      };
      return;
    }

    // 2. Référence / EAN exacts
    const ref = normalizeRef(line.supplier_reference);
    if (ref.length >= 3) {
      const byRef =
        resolveByReference(refIndex.get(ref) ?? [], supplierName, line.label)?.id ??
        eanIndex.get(ref);
      if (byRef) {
        results[index] = {
          matched_product_id: byRef,
          match_score: 1,
          match_method: "reference",
          match_status: "confirmed",
          pack_factor: DEFAULT_PACK_FACTOR,
        };
        return;
      }
    }
    pending.push(index);
  });

  if (pending.length === 0) return results;

  // 3. Candidats lexicaux (trigramme sur libellé normalisé)
  const candidates = new Map<number, Map<string, Candidate>>();
  for (const index of pending) {
    const map = new Map<string, Candidate>();
    candidates.set(index, map);
    const query = normalizeLabel(lines[index]!.label);
    if (!query) continue;
    const { data } = await supabase.rpc("search_catalog", {
      q: query,
      max_results: 8,
      ...(scoped ? { supplier_names: scopeSuppliers } : {}),
    });
    for (const row of data ?? []) {
      map.set(row.id, {
        id: row.id,
        label: row.label,
        price: row.price ?? null,
        lexical: typeof row.score === "number" ? row.score : 0,
        semantic: 0,
      });
    }
  }

  // 4. Candidats sémantiques (embeddings) en complément, pour tout le monde
  const { count } = await supabase
    .from("catalog_products")
    .select("id", { count: "exact", head: true })
    .not("embedding", "is", null);

  if ((count ?? 0) > 0) {
    let vectors: number[][] = [];
    try {
      // batchSize 1: see embedTexts' doc comment — this model's dynamic quantization
      // makes a text's embedding depend on which other texts share its batch, which
      // silently corrupted ranking here (confirmed on a real invoice: "batavia x 12
      // local c1" found 5 real "Batavia" catalog matches embedded alone, zero when
      // batched with the invoice's other lines).
      vectors = await embedTexts(
        pending.map((index) => normalizeLabel(lines[index]!.label)),
        1,
      );
    } catch {
      vectors = [];
    }
    for (let i = 0; i < pending.length; i += 1) {
      const vector = vectors[i];
      if (!vector) continue;
      const index = pending[i]!;
      const query_embedding = JSON.stringify(vector) as unknown as string;
      const { data } = scoped
        ? await supabase.rpc("match_catalog_embedding_scoped", {
            query_embedding,
            supplier_names: scopeSuppliers,
            max_results: 8,
          })
        : await supabase.rpc("match_catalog_embedding", { query_embedding, max_results: 8 });
      const map = candidates.get(index)!;
      for (const row of data ?? []) {
        const similarity = typeof row.similarity === "number" ? row.similarity : 0;
        const existing = map.get(row.id);
        if (existing) existing.semantic = similarity;
        else
          map.set(row.id, {
            id: row.id,
            label: row.label,
            price: row.price ?? null,
            lexical: 0,
            semantic: similarity,
          });
      }
    }
  }

  // 5. Re-classement combiné : lexical + sémantique + tokens + grammage + prix
  for (const index of pending) {
    const line = lines[index]!;
    const map = candidates.get(index);
    if (!map || map.size === 0) continue;
    const packFactor = normalizePackFactor(results[index]!.pack_factor);
    const comparablePrice = line.unit_price
      ? line.unit_price / packFactor
      : (line.unit_price ?? null);

    let best: { candidate: Candidate; score: number } | null = null;
    for (const candidate of map.values()) {
      const lexical = Math.min(candidate.lexical, 1);
      // A high semantic score with zero lexical corroboration (search_catalog's trigram/ILIKE
      // found no textual overlap at all) is this app's small local embedding model's classic
      // false-positive signature on short, generic French labels — confirmed on real data:
      // "persil coupe 1kg" scored 92% similar to both "fumet de poisson 1kg" and "cèpes en
      // morceaux 1kg" (lexical=0 for both), which outscored the real match "Persil Frisé"
      // (lexical=0.29) and got silently attached as matched_product_id. Every validated
      // genuine reformulation on record (steak haché, rôti de porc, thé vert menthe) already
      // has lexical > 0, so this penalty only ever discounts the isolated/false-positive case.
      const SEMANTIC_ISOLATION_PENALTY = 0.15;
      const semanticRaw = Math.min(candidate.semantic, 1);
      const semantic = lexical > 0 ? semanticRaw : semanticRaw * SEMANTIC_ISOLATION_PENALTY;
      const tokens = tokenScore(line.label, candidate.label);
      const base =
        0.35 * Math.max(lexical, semantic) + 0.2 * Math.min(lexical, semantic) + 0.45 * tokens;
      const score =
        base +
        0.08 * sizeScore(line.label, candidate.label) +
        0.07 * priceScore(comparablePrice, candidate.price);
      const clamped = Math.max(0, Math.min(0.99, score));
      if (!best || clamped > best.score) best = { candidate, score: clamped };
    }

    // Floor below which we'd rather show nothing than a guess: analysis of a real
    // fruits/légumes invoice found this score band mixes genuinely correct short-label
    // matches (Coriandre 0.27, Kiwi 0.28, Aubergine 0.31-0.33) with completely unrelated
    // ones (Tomate → Lessive poudre 0.26, Cranberry → Rôti Veau 0.21, Carotte → Pâté de
    // Campagne 0.33) — score alone can't reliably separate them here (short catalog
    // labels like "Aubergine" structurally cap lexical similarity regardless of
    // correctness). Raising this floor trades away some correct low-confidence
    // auto-suggestions for suppressing the clearly-wrong ones, which a still-empty
    // `catalog_products.family` (the ERP feed never sends it) can't do more precisely.
    const MIN_SUGGESTION_SCORE = 0.35;
    if (!best || best.score < MIN_SUGGESTION_SCORE) continue;
    results[index] = {
      matched_product_id: best.candidate.id,
      match_score: best.score,
      match_method: "libellé",
      match_status: statusFor(best.score, thresholds),
      pack_factor: results[index]!.pack_factor,
    };
  }

  return results;
}
