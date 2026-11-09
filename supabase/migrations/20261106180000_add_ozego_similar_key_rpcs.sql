-- Produits similaires par identifiant Ozego tronqué. Un ozego_id complet (ex. '31.4.72.139') a pour
-- premier segment le code du fournisseur ; les segments suivants ('4.72.139') identifient le produit.
-- La clé "similaire" est donc l'identifiant privé de son premier segment. Elle vaut NULL quand
-- l'identifiant n'a pas de point, commence par un point ou n'a rien après le premier point : le
-- code applicatif retombe alors sur l'identifiant complet (RPC existantes, laissées intactes).

CREATE OR REPLACE FUNCTION public.ozego_similar_key(id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN position('.' in btrim(id)) > 1
      THEN NULLIF(substr(btrim(id), position('.' in btrim(id)) + 1), '')
  END;
$$;

CREATE INDEX IF NOT EXISTS idx_catalog_products_ozego_similar_key
  ON public.catalog_products (public.ozego_similar_key(ozego_id))
  WHERE ozego_id IS NOT NULL;

-- Même forme de retour que catalog_variants_by_ozego : ozego_id est l'identifiant complet de
-- chaque offre, ce qui permet de savoir d'où elle vient.
CREATE OR REPLACE FUNCTION public.catalog_variants_by_ozego_key(keys text[])
RETURNS TABLE(ozego_id text, id uuid, reference text, label text, ean text, family text, unit text, price numeric, supplier_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT p.ozego_id, p.id, p.reference, p.label, p.ean, p.family, p.unit, p.price, p.supplier_name
  FROM public.catalog_products p
  WHERE p.is_active
    AND p.price IS NOT NULL
    AND public.ozego_similar_key(p.ozego_id) = ANY(keys);
$$;

-- Même forme de retour que cheapest_by_ozego. L'offre la moins chère de chaque clé est renvoyée
-- avec son ozego_id complet ; variants_count compte les offres actives de la clé.
CREATE OR REPLACE FUNCTION public.cheapest_by_ozego_key(keys text[])
RETURNS TABLE(ozego_id text, id uuid, reference text, label text, ean text, family text, unit text, price numeric, supplier_name text, variants_count integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (public.ozego_similar_key(p.ozego_id))
         p.ozego_id, p.id, p.reference, p.label, p.ean, p.family, p.unit, p.price, p.supplier_name,
         (SELECT count(*)::int FROM public.catalog_products c
           WHERE c.is_active
             AND public.ozego_similar_key(c.ozego_id) = public.ozego_similar_key(p.ozego_id)
         ) AS variants_count
  FROM public.catalog_products p
  WHERE p.is_active
    AND p.price IS NOT NULL
    AND public.ozego_similar_key(p.ozego_id) = ANY(keys)
  ORDER BY public.ozego_similar_key(p.ozego_id), p.price ASC, p.id;
$$;

-- Appelables uniquement par un utilisateur connecté (sous RLS) ou par le serveur, comme
-- les autres fonctions de lecture du catalogue.
REVOKE EXECUTE ON FUNCTION
  public.ozego_similar_key(text),
  public.catalog_variants_by_ozego_key(text[]),
  public.cheapest_by_ozego_key(text[])
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.ozego_similar_key(text),
  public.catalog_variants_by_ozego_key(text[]),
  public.cheapest_by_ozego_key(text[])
TO authenticated, service_role;
