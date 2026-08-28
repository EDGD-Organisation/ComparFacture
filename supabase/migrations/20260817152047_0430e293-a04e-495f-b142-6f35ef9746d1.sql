CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_key ON public.suppliers (lower(name));

CREATE TABLE public.catalog_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL,
  label TEXT NOT NULL,
  ean TEXT,
  price NUMERIC(14,4),
  currency TEXT NOT NULL DEFAULT 'EUR',
  unit TEXT,
  family TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'import',
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalog_products_reference_key ON public.catalog_products (lower(reference));
CREATE INDEX catalog_products_label_trgm ON public.catalog_products USING gin (label gin_trgm_ops);
CREATE INDEX catalog_products_ean_idx ON public.catalog_products (ean);
CREATE INDEX catalog_products_embedding_idx ON public.catalog_products USING hnsw (embedding vector_cosine_ops);

CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  currency TEXT NOT NULL DEFAULT 'EUR',
  total_ht NUMERIC(14,2),
  total_ttc NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  file_path TEXT,
  file_name TEXT,
  file_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  line_number INT NOT NULL DEFAULT 0,
  supplier_reference TEXT,
  label TEXT NOT NULL,
  quantity NUMERIC(14,4) NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price NUMERIC(14,4),
  discount_percent NUMERIC(8,4),
  line_total NUMERIC(14,4),
  matched_product_id UUID REFERENCES public.catalog_products(id) ON DELETE SET NULL,
  match_score NUMERIC(5,4),
  match_method TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  manual_override BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoice_lines_invoice_idx ON public.invoice_lines (invoice_id);

CREATE TABLE public.product_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name TEXT,
  supplier_reference TEXT,
  supplier_label TEXT,
  product_id UUID NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_mappings_key ON public.product_mappings (coalesce(lower(supplier_name),''), coalesce(lower(supplier_reference), lower(supplier_label), ''));

CREATE TABLE public.catalog_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  products_count INT NOT NULL DEFAULT 0,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  tolerance_percent NUMERIC(6,3) NOT NULL DEFAULT 2,
  auto_confirm_score NUMERIC(5,4) NOT NULL DEFAULT 0.9,
  review_score NUMERIC(5,4) NOT NULL DEFAULT 0.6,
  erp_api_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (id) VALUES (true);

CREATE TRIGGER t_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_catalog_products_updated BEFORE UPDATE ON public.catalog_products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_invoices_updated BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_invoice_lines_updated BEFORE UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_product_mappings_updated BEFORE UPDATE ON public.product_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers, public.catalog_products, public.invoices, public.invoice_lines, public.product_mappings, public.catalog_sync_runs, public.app_settings TO anon, authenticated;
GRANT ALL ON public.suppliers, public.catalog_products, public.invoices, public.invoice_lines, public.product_mappings, public.catalog_sync_runs, public.app_settings TO service_role;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_suppliers" ON public.suppliers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_catalog_products" ON public.catalog_products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_invoices" ON public.invoices FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_invoice_lines" ON public.invoice_lines FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_product_mappings" ON public.product_mappings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_catalog_sync_runs" ON public.catalog_sync_runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_app_settings" ON public.app_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.search_catalog(q TEXT, max_results INT DEFAULT 10)
RETURNS TABLE (id UUID, reference TEXT, label TEXT, ean TEXT, price NUMERIC, unit TEXT, score REAL)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.reference, p.label, p.ean, p.price, p.unit,
         GREATEST(similarity(p.label, q), similarity(coalesce(p.reference,''), q)) AS score
  FROM public.catalog_products p
  WHERE p.is_active
    AND (p.label ILIKE '%'||q||'%' OR p.reference ILIKE '%'||q||'%' OR coalesce(p.ean,'') ILIKE '%'||q||'%'
         OR similarity(p.label, q) > 0.15)
  ORDER BY score DESC, p.label
  LIMIT max_results;
$$;

CREATE OR REPLACE FUNCTION public.match_catalog_embedding(query_embedding vector(1536), max_results INT DEFAULT 5)
RETURNS TABLE (id UUID, reference TEXT, label TEXT, price NUMERIC, unit TEXT, similarity REAL)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.reference, p.label, p.price, p.unit,
         (1 - (p.embedding <=> query_embedding))::real AS similarity
  FROM public.catalog_products p
  WHERE p.embedding IS NOT NULL AND p.is_active
  ORDER BY p.embedding <=> query_embedding
  LIMIT max_results;
$$;