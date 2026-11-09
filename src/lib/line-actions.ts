import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../integrations/supabase/types";
import { normalizePackFactor } from "./pack";

type Client = SupabaseClient<Database>;

/**
 * The 3 comparison pages that can validate a line's match, in their fixed
 * left-to-right order. Validating a line on one page locks it for editing on
 * every later page in this list, while earlier pages (and the page that did
 * the validating) stay editable — see `isLineLocked`.
 */
export const STAGE_ORDER = ["fournisseur", "ozego", "ozego-preferes"] as const;
export type Stage = (typeof STAGE_ORDER)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  fournisseur: "Référence fournisseur",
  ozego: "Ozego · Autres fournisseurs",
  "ozego-preferes": "Ozego · Fournisseurs préférés",
};

export function stageLabel(stage: string | null): string | null {
  if (!stage) return null;
  return STAGE_LABEL[stage as Stage] ?? stage;
}

export function isLineLocked(line: { validated_stage: string | null }, stage: Stage): boolean {
  const validatedIndex = STAGE_ORDER.indexOf(line.validated_stage as Stage);
  if (validatedIndex === -1) return false;
  return validatedIndex < STAGE_ORDER.indexOf(stage);
}

export type ActionLine = {
  id: string;
  supplier_reference: string | null;
  label: string;
  pack_factor: number | null;
  matched_product_id: string | null;
};

export type ActionProduct = { id: string };

/** The invoice a line belongs to: where its learned mapping is keyed and which caches to refresh. */
export type LineContext = {
  invoiceId: string;
  prospectId: string | null;
  supplierName: string | null;
};

export const PROSPECT_MATCHING_LINES_KEY = "prospect-matching-lines";

/**
 * Préfixes React Query à rafraîchir après une écriture sur les lignes d'une facture : la facture
 * elle-même, le comparatif du prospect, la vue « Tous les rapprochements » et la liste des
 * factures. `ozego` ajoute le cache des variantes Ozego (dont la meilleure offre est dérivée).
 */
export function lineCacheKeys(
  context: Pick<LineContext, "invoiceId" | "prospectId">,
  { ozego }: { ozego: boolean },
): string[][] {
  const prospect = context.prospectId ? [context.prospectId] : [];
  return [
    ["invoice-lines", context.invoiceId],
    ["prospect-lines", ...prospect],
    [PROSPECT_MATCHING_LINES_KEY, ...prospect],
    ["invoices", ...prospect],
    ...(ozego ? [["ozego-variants"]] : []),
  ];
}

/** `changed`: the invoice_lines row was written (caches must refresh); `error`: message to show. */
export type ActionResult = { changed: boolean; error: string | null };

export function matchUpdate(product: ActionProduct | null, stage: Stage) {
  return {
    matched_product_id: product?.id ?? null,
    match_status: product ? "confirmed" : "unmatched",
    match_method: product ? "manuel" : null,
    match_score: product ? 1 : null,
    manual_override: true,
    validated_stage: product ? stage : null,
  };
}

export function confirmUpdate() {
  return {
    match_status: "confirmed",
    manual_override: true,
    validated_stage: "fournisseur" as const,
  };
}

export function shouldLearnMapping(
  line: ActionLine,
  product: ActionProduct | null,
): product is ActionProduct {
  return Boolean(product && (line.supplier_reference || line.label));
}

async function upsertProductMapping(
  client: Client,
  line: ActionLine,
  supplierName: string | null,
  productId: string,
  packFactor: number,
  updateProduct: boolean,
): Promise<string | null> {
  let existing = client.from("product_mappings").select("id");
  existing = supplierName
    ? existing.ilike("supplier_name", supplierName)
    : existing.is("supplier_name", null);
  existing = line.supplier_reference
    ? existing.ilike("supplier_reference", line.supplier_reference)
    : existing.ilike("supplier_label", line.label);
  const { data: found, error: lookupError } = await existing.maybeSingle();
  if (lookupError) return lookupError.message;

  if (found) {
    const { error } = await client
      .from("product_mappings")
      .update(
        updateProduct
          ? { product_id: productId, pack_factor: packFactor }
          : { pack_factor: packFactor },
      )
      .eq("id", found.id);
    return error?.message ?? null;
  }
  const { error } = await client.from("product_mappings").insert({
    supplier_name: supplierName,
    supplier_reference: line.supplier_reference,
    supplier_label: line.label,
    product_id: productId,
    pack_factor: packFactor,
  });
  return error?.message ?? null;
}

const learnFailed = (saved: string, message: string) =>
  `${saved}, mais l'apprentissage a échoué : ${message}`;

/** Choose/change the product of a line, or remove its match when `product` is null. */
export async function applyMatchAction(
  client: Client,
  line: ActionLine,
  context: LineContext,
  product: ActionProduct | null,
  stage: Stage,
): Promise<ActionResult> {
  const { error } = await client
    .from("invoice_lines")
    .update(matchUpdate(product, stage))
    .eq("id", line.id);
  if (error) return { changed: false, error: error.message };
  if (shouldLearnMapping(line, product)) {
    const learnError = await upsertProductMapping(
      client,
      line,
      context.supplierName,
      product.id,
      normalizePackFactor(line.pack_factor),
      true,
    );
    if (learnError)
      return { changed: true, error: learnFailed("Correspondance enregistrée", learnError) };
  }
  return { changed: true, error: null };
}

export async function confirmLineAction(client: Client, line: ActionLine): Promise<ActionResult> {
  const { error } = await client.from("invoice_lines").update(confirmUpdate()).eq("id", line.id);
  return { changed: !error, error: error?.message ?? null };
}

export async function deleteLineAction(client: Client, line: ActionLine): Promise<ActionResult> {
  const { error } = await client.from("invoice_lines").update({ excluded: true }).eq("id", line.id);
  return { changed: !error, error: error?.message ?? null };
}

/** État d'une ligne avant une écriture de rapprochement, de quoi la remettre comme elle était. */
export type LineSnapshot = {
  matched_product_id: string | null;
  match_status: string;
  match_method: string | null;
  match_score: number | null;
  manual_override: boolean;
  validated_stage: string | null;
  pack_factor: number | null;
};

export function snapshotForUndo(line: LineSnapshot): LineSnapshot {
  return {
    matched_product_id: line.matched_product_id,
    match_status: line.match_status,
    match_method: line.match_method,
    match_score: line.match_score,
    manual_override: line.manual_override,
    validated_stage: line.validated_stage,
    pack_factor: line.pack_factor,
  };
}

export function restoreUpdate(snapshot: LineSnapshot) {
  return {
    matched_product_id: snapshot.matched_product_id,
    match_status: snapshot.match_status,
    match_method: snapshot.match_method,
    match_score: snapshot.match_score,
    manual_override: snapshot.manual_override,
    validated_stage: snapshot.validated_stage,
    pack_factor: normalizePackFactor(snapshot.pack_factor),
  };
}

/** Annule un retrait de rapprochement : réécrit l'état pris avant l'écriture (apprentissage intact). */
export async function restoreLineAction(
  client: Client,
  line: Pick<ActionLine, "id">,
  snapshot: LineSnapshot,
): Promise<ActionResult> {
  const { error } = await client
    .from("invoice_lines")
    .update(restoreUpdate(snapshot))
    .eq("id", line.id);
  return { changed: !error, error: error?.message ?? null };
}

/** Annule une suppression (soft delete) : la ligne redevient visible. */
export async function undeleteLineAction(
  client: Client,
  line: Pick<ActionLine, "id">,
): Promise<ActionResult> {
  const { error } = await client
    .from("invoice_lines")
    .update({ excluded: false })
    .eq("id", line.id);
  return { changed: !error, error: error?.message ?? null };
}

export async function savePackFactorAction(
  client: Client,
  line: ActionLine,
  context: LineContext,
  value: number,
): Promise<ActionResult> {
  const factor = normalizePackFactor(value);
  const { error } = await client
    .from("invoice_lines")
    .update({ pack_factor: factor })
    .eq("id", line.id);
  if (error) return { changed: false, error: error.message };
  if (line.matched_product_id) {
    const learnError = await upsertProductMapping(
      client,
      line,
      context.supplierName,
      line.matched_product_id,
      factor,
      false,
    );
    if (learnError)
      return { changed: true, error: learnFailed("Conditionnement enregistré", learnError) };
  }
  return { changed: true, error: null };
}
