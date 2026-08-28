ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS pack_factor numeric NOT NULL DEFAULT 1;
ALTER TABLE public.product_mappings ADD COLUMN IF NOT EXISTS pack_factor numeric NOT NULL DEFAULT 1;