import { serverSupabase } from "./db.server";
import { matchLines, type Thresholds } from "./matching.server";
import { structureInvoiceImage } from "./structure.server";

async function getThresholds(): Promise<Thresholds> {
  const supabase = serverSupabase();
  const { data } = await supabase
    .from("app_settings")
    .select("auto_confirm_score, review_score")
    .maybeSingle();
  return {
    autoConfirm: data?.auto_confirm_score ?? 0.9,
    review: data?.review_score ?? 0.6,
  };
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function runInvoiceProcessing(invoiceId: string) {
  const supabase = serverSupabase();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, file_path, file_name, file_mime")
    .eq("id", invoiceId)
    .single();
  if (error || !invoice) throw new Error("Facture introuvable");
  if (!invoice.file_path) throw new Error("Aucun fichier associé à cette facture");

  await supabase
    .from("invoices")
    .update({ status: "processing", error_message: null })
    .eq("id", invoiceId);

  try {
    const download = await supabase.storage.from("invoices").download(invoice.file_path);
    if (download.error || !download.data)
      throw new Error("Impossible de lire le fichier de la facture");

    const base64 = toBase64(await download.data.arrayBuffer());
    const extracted = await structureInvoiceImage(base64, invoice.file_mime || "application/pdf");

    let supplierId: string | null = null;
    if (extracted.supplier_name) {
      const { data: existing } = await supabase
        .from("suppliers")
        .select("id")
        .ilike("name", extracted.supplier_name)
        .maybeSingle();
      if (existing) {
        supplierId = existing.id;
      } else {
        const { data: created } = await supabase
          .from("suppliers")
          .insert({ name: extracted.supplier_name })
          .select("id")
          .single();
        supplierId = created?.id ?? null;
      }
    }

    await supabase.from("invoice_lines").delete().eq("invoice_id", invoiceId);

    const thresholds = await getThresholds();
    const matches = await matchLines(
      extracted.lines.map((line) => ({
        supplier_reference: line.supplier_reference,
        label: line.label,
        unit: line.unit,
        unit_price: line.unit_price,
      })),
      extracted.supplier_name,
      thresholds,
    );

    if (extracted.lines.length > 0) {
      const rows = extracted.lines.map((line, index) => ({
        invoice_id: invoiceId,
        line_number: index + 1,
        supplier_reference: line.supplier_reference,
        label: line.label,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        discount_percent: line.discount_percent,
        line_total: line.line_total,
        ...matches[index]!,
      }));
      const { error: insertError } = await supabase.from("invoice_lines").insert(rows);
      if (insertError) throw new Error(insertError.message);
    }

    const { error: updateError } = await supabase
      .from("invoices")
      .update({
        supplier_id: supplierId,
        supplier_name: extracted.supplier_name,
        invoice_number: extracted.invoice_number,
        invoice_date: extracted.invoice_date,
        currency: extracted.currency || "EUR",
        total_ht: extracted.total_ht,
        total_ttc: extracted.total_ttc,
        status: "processed",
        error_message: null,
      })
      .eq("id", invoiceId);
    if (updateError) throw new Error(updateError.message);

    return { lines: extracted.lines.length };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Erreur inconnue";
    await supabase
      .from("invoices")
      .update({ status: "error", error_message: message })
      .eq("id", invoiceId);
    throw new Error(message);
  }
}

export async function runInvoiceRematch(invoiceId: string) {
  const supabase = serverSupabase();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("supplier_name")
    .eq("id", invoiceId)
    .single();
  const { data: lines } = await supabase
    .from("invoice_lines")
    .select("id, supplier_reference, label, unit, unit_price, manual_override")
    .eq("invoice_id", invoiceId)
    .order("line_number");

  const target = (lines ?? []).filter((line) => !line.manual_override);
  if (target.length === 0) return { updated: 0 };

  const thresholds = await getThresholds();
  const matches = await matchLines(
    target.map((line) => ({
      supplier_reference: line.supplier_reference,
      label: line.label,
      unit: line.unit,
      unit_price: line.unit_price,
    })),
    invoice?.supplier_name ?? null,
    thresholds,
  );

  for (let i = 0; i < target.length; i += 1) {
    await supabase.from("invoice_lines").update(matches[i]!).eq("id", target[i]!.id);
  }
  return { updated: target.length };
}
