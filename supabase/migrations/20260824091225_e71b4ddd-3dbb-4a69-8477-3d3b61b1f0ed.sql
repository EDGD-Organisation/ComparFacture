ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS ozego_id text,
  ADD COLUMN IF NOT EXISTS supplier_name text;

CREATE INDEX IF NOT EXISTS idx_catalog_products_ozego_id ON public.catalog_products (ozego_id);

CREATE OR REPLACE FUNCTION public.cheapest_by_ozego(ids text[])
RETURNS TABLE(ozego_id text, id uuid, reference text, label text, ean text, family text, unit text, price numeric, supplier_name text, variants_count integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (p.ozego_id)
         p.ozego_id, p.id, p.reference, p.label, p.ean, p.family, p.unit, p.price, p.supplier_name,
         (SELECT count(*)::int FROM public.catalog_products c
           WHERE c.ozego_id = p.ozego_id AND c.is_active) AS variants_count
  FROM public.catalog_products p
  WHERE p.is_active AND p.ozego_id = ANY(ids) AND p.price IS NOT NULL
  ORDER BY p.ozego_id, p.price ASC;
$$;