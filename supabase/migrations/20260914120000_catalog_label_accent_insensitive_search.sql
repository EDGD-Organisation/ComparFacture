-- ILIKE is case-insensitive but never accent-insensitive ("E" and "É" are different
-- characters to Postgres regardless of collation) — confirmed on the live catalog:
-- searching "ECHALOTE" against a label stored as "Échalote" returns zero rows via plain
-- ILIKE. The manual product search (ProductPicker.tsx, catalogue.tsx) has no fallback
-- for this at all; search_catalog's trigram similarity happens to paper over it
-- sometimes, but that's incidental, not a real fix.
--
-- unaccent() is STABLE (depends on the session's default text search config), which
-- Postgres won't allow inside a generated column — pin it to a fixed dictionary via a
-- thin wrapper marked IMMUTABLE, the standard workaround for this exact limitation.
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent', $1) $$;

ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS label_unaccent text
    GENERATED ALWAYS AS (public.immutable_unaccent(lower(label))) STORED;

CREATE INDEX IF NOT EXISTS catalog_products_label_unaccent_trgm
  ON public.catalog_products USING gin (label_unaccent gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_catalog(q TEXT, max_results INT DEFAULT 10)
RETURNS TABLE (id UUID, reference TEXT, label TEXT, ean TEXT, price NUMERIC, unit TEXT, score REAL)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.reference, p.label, p.ean, p.price, p.unit,
         GREATEST(
           similarity(p.label_unaccent, public.immutable_unaccent(lower(q))),
           similarity(coalesce(p.reference,''), q)
         ) AS score
  FROM public.catalog_products p
  WHERE p.is_active
    AND (p.label_unaccent ILIKE '%'||public.immutable_unaccent(lower(q))||'%'
         OR p.reference ILIKE '%'||q||'%'
         OR coalesce(p.ean,'') ILIKE '%'||q||'%'
         OR similarity(p.label_unaccent, public.immutable_unaccent(lower(q))) > 0.15)
  ORDER BY score DESC, p.label
  LIMIT max_results;
$$;
