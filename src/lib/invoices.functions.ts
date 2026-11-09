import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdInput = z.object({ invoiceId: z.string().uuid() });

// Les commerciaux téléversent les factures, ce qui déclenche l'extraction : ils ne peuvent lancer
// le traitement que d'une facture encore en attente. Rejouer une facture déjà analysée efface ses
// lignes, donc ses validations : réservé aux experts.
export const processInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./auth.server");
    const role = await requireRole(context.supabase, context.userId, ["commercial", "expert"]);
    const { runInvoiceProcessing } = await import("./invoices.server");
    return runInvoiceProcessing(data.invoiceId, { pendingOnly: role !== "expert" });
  });

export const rematchInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./auth.server");
    await requireRole(context.supabase, context.userId, ["expert"]);
    const { runInvoiceRematch } = await import("./invoices.server");
    return runInvoiceRematch(data.invoiceId);
  });
