-- Correctif de performance de 20261106180000 : « canceling statement due to statement timeout » au
-- chargement des comparaisons Ozego.
--
-- Mesuré sur 15 030 produits et 121 clés réelles : cheapest_by_ozego_key prenait 151 s (limite
-- Supabase ≈ 8 s). Deux causes :
--  1. variants_count était une sous-requête corrélée : un balayage complet de catalog_products
--     (avec appel de fonction par ligne) pour CHAQUE produit trouvé, soit trouvés × 15 030 appels.
--  2. L'index partiel (WHERE ozego_id IS NOT NULL) n'était jamais utilisé : les requêtes ne
--     répétaient pas la condition et ozego_similar_key n'était pas STRICT, donc PostgreSQL ne pouvait
--     pas prouver que l'index couvrait la recherche.
-- Le résultat des fonctions est inchangé (mêmes colonnes, mêmes valeurs).

-- STRICT : une entrée NULL donne NULL sans exécuter le corps, ce qui permet à PostgreSQL de
-- conclure que `ozego_similar_key(ozego_id) = ANY(...)` implique `ozego_id IS NOT NULL`.
CREATE OR REPLACE FUNCTION public.ozego_similar_key(id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN position('.' in btrim(id)) > 1
      THEN NULLIF(substr(btrim(id), position('.' in btrim(id)) + 1), '')
  END;
$$;

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
    AND p.ozego_id IS NOT NULL
    AND public.ozego_similar_key(p.ozego_id) = ANY(keys);
$$;

-- Les produits trouvés sont lus une seule fois (hits) ; le nombre de variantes se calcule sur ce
-- petit ensemble au lieu de relire la table. variants_count compte les offres actives de la clé,
-- prix renseigné ou non, comme avant ; l'offre renvoyée est la moins chère (égalité : plus petit id).
CREATE OR REPLACE FUNCTION public.cheapest_by_ozego_key(keys text[])
RETURNS TABLE(ozego_id text, id uuid, reference text, label text, ean text, family text, unit text, price numeric, supplier_name text, variants_count integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH hits AS (
    SELECT p.ozego_id, p.id, p.reference, p.label, p.ean, p.family, p.unit, p.price, p.supplier_name,
           public.ozego_similar_key(p.ozego_id) AS k
    FROM public.catalog_products p
    WHERE p.is_active
      AND p.ozego_id IS NOT NULL
      AND public.ozego_similar_key(p.ozego_id) = ANY(keys)
  ),
  counts AS (
    SELECT h.k, count(*)::int AS n FROM hits h GROUP BY h.k
  ),
  best AS (
    SELECT DISTINCT ON (h.k) h.*
    FROM hits h
    WHERE h.price IS NOT NULL
    ORDER BY h.k, h.price ASC, h.id
  )
  SELECT b.ozego_id, b.id, b.reference, b.label, b.ean, b.family, b.unit, b.price, b.supplier_name, c.n
  FROM best b
  JOIN counts c ON c.k = b.k;
$$;
