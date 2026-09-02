import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const IdInput = z.object({ invoiceId: z.string().uuid() });

export const processInvoice = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data }) => {
    const { runInvoiceProcessing } = await import("./invoices.server");
    return runInvoiceProcessing(data.invoiceId);
  });

export const rematchInvoice = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data }) => {
    const { runInvoiceRematch } = await import("./invoices.server");
    return runInvoiceRematch(data.invoiceId);
  });
