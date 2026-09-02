-- Backs a real multi-select for "fournisseurs préférés" (was a free-text,
-- comma-separated field) with the actual list of suppliers known to the catalog,
-- instead of the user having to type exact supplier names from memory.
CREATE OR REPLACE FUNCTION public.distinct_catalog_suppliers()
RETURNS TABLE (supplier_name TEXT)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT DISTINCT supplier_name
  FROM public.catalog_products
  WHERE is_active AND supplier_name IS NOT NULL
  ORDER BY supplier_name;
$$;
