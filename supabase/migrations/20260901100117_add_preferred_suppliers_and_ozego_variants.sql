-- Per-prospect "preferred suppliers" shortlist, matching the manual comparatif workflow
-- (e.g. "Alternative chez vos fournisseurs préférés (transgourmet, France frais, krill)")
-- — each client/prospect has its own habitual supplier list, not a single app-wide one.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS preferred_suppliers text[] NOT NULL DEFAULT '{}';

-- cheapest_by_ozego only ever returns the single cheapest variant per group. Reproducing
-- the manual comparatif's 3 cases (same supplier as the invoice / cheapest anywhere /
-- cheapest among preferred suppliers) needs every priced variant in the group so the
-- client can pick out whichever supplier(s) matter for each case, without three separate
-- round trips or three RPC signatures.
CREATE OR REPLACE FUNCTION public.catalog_variants_by_ozego(ids text[])
RETURNS TABLE(ozego_id text, id uuid, reference text, label text, ean text, family text, unit text, price numeric, supplier_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT p.ozego_id, p.id, p.reference, p.label, p.ean, p.family, p.unit, p.price, p.supplier_name
  FROM public.catalog_products p
  WHERE p.is_active AND p.ozego_id = ANY(ids) AND p.price IS NOT NULL;
$$;
