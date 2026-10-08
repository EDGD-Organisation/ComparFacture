import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdInput = z.object({ invoiceId: z.string().uuid() });

// Experts upload invoice files, which triggers the extraction — so they may start processing.
export const processInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./auth.server");
    await requireRole(context.supabase, context.userId, ["expert", "admin"]);
    const { runInvoiceProcessing } = await import("./invoices.server");
    return runInvoiceProcessing(data.invoiceId);
  });

export const rematchInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./auth.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    const { runInvoiceRematch } = await import("./invoices.server");
    return runInvoiceRematch(data.invoiceId);
  });
