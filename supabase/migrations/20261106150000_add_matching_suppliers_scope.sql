-- Fournisseurs de rattachement par comparatif : quand la liste n'est pas vide, le rapprochement
-- des lignes de facture ne considère que les produits de ces fournisseurs. Liste vide = pas de
-- restriction (comportement historique).
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS matching_suppliers text[] NOT NULL DEFAULT '{}';

-- Un commercial peut écrire cette colonne à la création : on borne la liste pour qu'elle ne
-- devienne pas une charge CPU côté serveur à chaque traitement de facture.
ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_matching_suppliers_max;
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_matching_suppliers_max CHECK (cardinality(matching_suppliers) <= 50);

-- search_catalog gagne un 3e paramètre optionnel. L'ancienne signature (text, int) est supprimée
-- d'abord : deux surcharges rendraient ambigus les appels PostgREST qui ne passent que q et
-- max_results. Les appelants existants restent valides grâce à la valeur par défaut.
DROP FUNCTION IF EXISTS public.search_catalog(TEXT, INT);
CREATE OR REPLACE FUNCTION public.search_catalog(
  q TEXT,
  max_results INT DEFAULT 10,
  supplier_names TEXT[] DEFAULT NULL
)
RETURNS TABLE (id UUID, reference TEXT, label TEXT, ean TEXT, price NUMERIC, unit TEXT, score REAL)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.reference, p.label, p.ean, p.price, p.unit,
         GREATEST(
           similarity(p.label_unaccent, public.immutable_unaccent(lower(q))),
           similarity(coalesce(p.reference,''), q)
         ) AS score
  FROM public.catalog_products p
  WHERE p.is_active
    AND (supplier_names IS NULL OR p.supplier_name = ANY(supplier_names))
    AND (p.label_unaccent ILIKE '%'||public.immutable_unaccent(lower(q))||'%'
         OR p.reference ILIKE '%'||q||'%'
         OR coalesce(p.ean,'') ILIKE '%'||q||'%'
         OR similarity(p.label_unaccent, public.immutable_unaccent(lower(q))) > 0.15)
  ORDER BY score DESC, p.label
  LIMIT max_results;
$$;

-- Variante restreinte à des fournisseurs de match_catalog_embedding. Le paramètre est un `vector`
-- sans dimension fixée, à dessein : la colonne est en 384 dimensions en local et en 1536 en
-- production (voir 20260902095830_local_embeddings_384_dim.sql, local uniquement), et cette
-- migration doit s'appliquer telle quelle aux deux. match_catalog_embedding n'est pas modifiée.
CREATE OR REPLACE FUNCTION public.match_catalog_embedding_scoped(
  query_embedding vector,
  supplier_names TEXT[],
  max_results INT DEFAULT 5
)
RETURNS TABLE (id UUID, reference TEXT, label TEXT, price NUMERIC, unit TEXT, similarity REAL)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.reference, p.label, p.price, p.unit,
         (1 - (p.embedding <=> query_embedding))::real AS similarity
  FROM public.catalog_products p
  WHERE p.embedding IS NOT NULL AND p.is_active AND p.supplier_name = ANY(supplier_names)
  ORDER BY p.embedding <=> query_embedding
  LIMIT max_results;
$$;

-- Les commerciaux n'ont aucune politique de lecture sur catalog_products (RLS) : la liste des
-- fournisseurs, nécessaire pour choisir les fournisseurs de rattachement à la création d'un
-- comparatif, leur serait renvoyée vide. La fonction passe en SECURITY DEFINER, limitée aux
-- deux rôles applicatifs, et n'expose que des noms de fournisseurs.
CREATE OR REPLACE FUNCTION public.distinct_catalog_suppliers()
RETURNS TABLE (supplier_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p.supplier_name
  FROM public.catalog_products p
  WHERE (public.is_expert() OR public.is_commercial())
    AND p.is_active AND p.supplier_name IS NOT NULL
  ORDER BY p.supplier_name;
$$;

-- Appelables uniquement par un utilisateur connecté (le client navigateur, sous RLS) ou par le
-- serveur (service_role). Sans cela, les droits par défaut de Supabase les ouvrent à anon : sans
-- effet aujourd'hui grâce à la RLS et à la garde de distinct_catalog_suppliers, mais autant ne pas
-- s'appuyer sur un seul garde-fou.
REVOKE EXECUTE ON FUNCTION
  public.search_catalog(TEXT, INT, TEXT[]),
  public.match_catalog_embedding_scoped(vector, TEXT[], INT),
  public.distinct_catalog_suppliers()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.search_catalog(TEXT, INT, TEXT[]),
  public.match_catalog_embedding_scoped(vector, TEXT[], INT),
  public.distinct_catalog_suppliers()
TO authenticated, service_role;
