-- ============================================================================
-- Bootstrap complet pour un NOUVEAU projet Supabase vide.
-- ============================================================================
-- À coller tel quel dans Supabase Studio → SQL Editor → Run, sur un projet
-- fraîchement créé (aucune donnée existante).
--
-- Ce fichier consolide, dans l'ordre chronologique, toutes les migrations de
-- supabase/migrations/ qui ont du sens sur une base neuve. Il n'est PAS
-- lui-même un fichier de migration (il ne va pas dans supabase/migrations/ et
-- le CLI Supabase ne le connaît pas) — voir la note de réconciliation en bas
-- de fichier si vous comptez piloter ce projet avec `supabase db push` par la
-- suite.
--
-- Trois fichiers de l'historique ont été volontairement exclus :
--   - 20260819122220_*.sql et 20260824091225_*.sql : purges de données
--     ciblant des lignes précises de l'ancien projet (par id de prospect /
--     nom de fournisseur) — sans objet sur une base vide.
--   - 20260824094934_*.sql : contient une faute de syntaxe SQL
--     ("ADD d prospects_status_check" au lieu de "ADD CONSTRAINT ...") qui
--     est un échec Postgres garanti. Son intention (colonnes status/
--     delivery_date + contrainte CHECK sur prospects) est entièrement
--     reprise, correctement, par le bloc "20260831101103" ci-dessous.
--
-- La migration "20260902095830" (embeddings locaux 384 dimensions) EST
-- incluse ici, volontairement, contrairement à l'avertissement qu'elle porte
-- dans son propre fichier — cet avertissement ne visait que le projet Supabase
-- de production existant, qui contient déjà de vrais embeddings 1536
-- dimensions. Sur un projet neuf et vide, c'est au contraire la variante
-- correcte : le code applicatif actuel (src/lib/embeddings.server.ts) ne
-- calcule plus que des vecteurs à 384 dimensions.
-- ============================================================================


-- ============================================================================
-- 20260817152047 — Schéma de base (fournisseurs, catalogue, factures, réglages)
-- ============================================================================
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


-- ============================================================================
-- 20260817152106 — Policies de stockage pour le futur bucket "invoices"
-- ============================================================================
CREATE POLICY "invoices_read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'invoices');
CREATE POLICY "invoices_insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'invoices');
CREATE POLICY "invoices_update" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'invoices') WITH CHECK (bucket_id = 'invoices');
CREATE POLICY "invoices_delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'invoices');


-- ============================================================================
-- 20260818124627 — Prospects
-- ============================================================================
CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospects TO anon, authenticated;
GRANT ALL ON public.prospects TO service_role;
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_prospects ON public.prospects FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER prospects_set_updated_at BEFORE UPDATE ON public.prospects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.invoices ADD COLUMN prospect_id uuid REFERENCES public.prospects(id) ON DELETE CASCADE;
CREATE INDEX invoices_prospect_id_idx ON public.invoices(prospect_id);


-- ============================================================================
-- 20260818143640 — Facteur de colisage (cartons/packs)
-- ============================================================================
ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS pack_factor numeric NOT NULL DEFAULT 1;
ALTER TABLE public.product_mappings ADD COLUMN IF NOT EXISTS pack_factor numeric NOT NULL DEFAULT 1;


-- ============================================================================
-- 20260828141457 — Identifiant Ozego + meilleur prix par groupe
-- ============================================================================
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


-- ============================================================================
-- 20260831101103 — Statut/date de livraison prospect (reprend l'intention
-- de la migration cassée 20260824094934, correctement cette fois)
-- ============================================================================
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS delivery_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospects_status_check'
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_status_check CHECK (status IN ('todo','in_progress','done'));
  END IF;
END $$;


-- ============================================================================
-- 20260831101408 — Bucket de stockage "invoices" (privé)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS open_invoices_bucket ON storage.objects;
CREATE POLICY open_invoices_bucket ON storage.objects
  FOR ALL
  USING (bucket_id = 'invoices')
  WITH CHECK (bucket_id = 'invoices');


-- ============================================================================
-- 20260831133147 — Unicité catalogue par fournisseur+ozego_id, clé ERP secrète
-- ============================================================================
DROP INDEX IF EXISTS public.catalog_products_reference_key;
CREATE UNIQUE INDEX catalog_products_reference_key
  ON public.catalog_products (
    coalesce(lower(supplier_name), ''),
    coalesce(lower(ozego_id), lower(reference))
  );

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


-- ============================================================================
-- 20260901100117 — Fournisseurs préférés par prospect + variantes Ozego
-- ============================================================================
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS preferred_suppliers text[] NOT NULL DEFAULT '{}';

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


-- ============================================================================
-- 20260902095830 — Embeddings locaux 384 dimensions
-- (voir l'avertissement en tête de fichier : correct ici car projet neuf/vide)
-- ============================================================================
DROP INDEX IF EXISTS public.catalog_products_embedding_idx;

ALTER TABLE public.catalog_products
  ALTER COLUMN embedding TYPE vector(384);

CREATE INDEX catalog_products_embedding_idx
  ON public.catalog_products USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_catalog_embedding(query_embedding vector(384), max_results INT DEFAULT 5)
RETURNS TABLE (id UUID, reference TEXT, label TEXT, price NUMERIC, unit TEXT, similarity REAL)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.reference, p.label, p.price, p.unit,
         (1 - (p.embedding <=> query_embedding))::real AS similarity
  FROM public.catalog_products p
  WHERE p.embedding IS NOT NULL AND p.is_active
  ORDER BY p.embedding <=> query_embedding
  LIMIT max_results;
$$;


-- ============================================================================
-- 20260902150000 — Liste des fournisseurs distincts du catalogue
-- ============================================================================
CREATE OR REPLACE FUNCTION public.distinct_catalog_suppliers()
RETURNS TABLE (supplier_name TEXT)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT DISTINCT supplier_name
  FROM public.catalog_products
  WHERE is_active AND supplier_name IS NOT NULL
  ORDER BY supplier_name;
$$;

-- ============================================================================
-- Fin du bootstrap. Vérifications suggérées après exécution :
--   - Table Editor : suppliers, catalog_products, invoices, invoice_lines,
--     product_mappings, catalog_sync_runs, app_settings, app_secrets,
--     prospects doivent tous exister.
--   - Storage : le bucket "invoices" doit exister et être privé.
--   - Database → Extensions : pg_trgm et vector doivent être "enabled".
--
-- Réconciliation avec le CLI Supabase (uniquement si vous voulez piloter ce
-- projet avec `supabase db push` plus tard) : le CLI ne saura pas que ces
-- migrations ont déjà été appliquées à la main. Avant le premier `db push`,
-- exécutez `supabase migration repair --status applied <version>` pour
-- chaque timestamp listé ci-dessus SAUF 20260824094934 (qui doit rester
-- "reverted"/non appliqué, sans quoi le CLI tentera de la rejouer et
-- échouera sur sa faute de syntaxe).
-- ============================================================================
