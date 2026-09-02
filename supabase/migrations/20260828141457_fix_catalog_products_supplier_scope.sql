-- Ozego comparatif integration: catalog_products.reference was only ever unique
-- globally (lower(reference)), from before ozego_id/supplier_name existed. Now that
-- the catalogue can hold rows from multiple suppliers (via GET /produits/comparatif),
-- two different suppliers can share the same reference string, which previously would
-- make the second supplier's import silently overwrite the first supplier's row.
-- Scope the uniqueness to (supplier_name, reference) instead, same pattern already
-- used by product_mappings_key.
DROP INDEX IF EXISTS public.catalog_products_reference_key;
CREATE UNIQUE INDEX catalog_products_reference_key
  ON public.catalog_products (coalesce(lower(supplier_name), ''), lower(reference));

-- The Ozego comparatif API needs an API key (x-api-key). It must NOT live on
-- app_settings: that table has "open_app_settings" RLS (USING (true) for anon,
-- authenticated) and is read from the browser client in reglages.tsx, so anything
-- stored there is effectively public to anyone holding the Supabase publishable key.
-- app_secrets has no anon/authenticated grant at all — only the service-role client
-- (supabaseAdmin, used server-side in catalog.functions.ts) can read or write it.
CREATE TABLE public.app_secrets (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  erp_api_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.app_secrets (id) VALUES (true);

CREATE TRIGGER t_app_secrets_updated BEFORE UPDATE ON public.app_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.app_secrets TO service_role;
