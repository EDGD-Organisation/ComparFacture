-- ============================================================================
-- ComparFacture : mise à jour de la base du 2026-11-06 (script unique)
-- ============================================================================
-- À coller tel quel dans Supabase Studio > SQL Editor > Run, sur le projet en ligne.
-- Regroupe 3 migrations de supabase/migrations/ (contenu repris à l'identique), dans l'ordre sûr.
-- Tout-ou-rien (BEGIN/COMMIT) et rejouable sans dégât (tout est idempotent).
-- Ne pas rejouer 20261007140000 ni 20261008100000 : déjà appliquées.
--
-- Effet sur l'application DÉJÀ déployée (ancienne version) : aucun, sauf l'étape 3 : l'ancienne
-- page « Même fournisseur » ne pourra plus valider de ligne (contrainte CHECK resserrée). Cette
-- page est supprimée par la nouvelle version.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ÉTAPE 1/3  fournisseurs de rattachement + droits
-- (source : supabase/migrations/20261106150000_add_matching_suppliers_scope.sql)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- ÉTAPE 2/3  identifiant Ozego tronqué (produits similaires)
-- (source : supabase/migrations/20261106180000_add_ozego_similar_key_rpcs.sql)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- ÉTAPE 3/3  suppression de l'étape « Ozego Même fournisseur »
-- (source : supabase/migrations/20261106160000_remove_ozego_meme_validated_stage.sql)
-- ---------------------------------------------------------------------------

-- The "Ozego · Même fournisseur" page was removed. Lines validated there
-- ("ozego-meme") were already locked on "ozego" and "ozego-preferes", exactly
-- like lines validated on "fournisseur", so they are moved to "fournisseur".
UPDATE public.invoice_lines
SET validated_stage = 'fournisseur'
WHERE validated_stage = 'ozego-meme';

DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.invoice_lines'::regclass
      AND c.contype = 'c'
      AND a.attname = 'validated_stage'
  LOOP
    EXECUTE format('ALTER TABLE public.invoice_lines DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_validated_stage_check
    CHECK (validated_stage IN ('fournisseur', 'ozego', 'ozego-preferes'));

COMMIT;

-- ============================================================================
-- CONTRÔLE (lecture seule) : toutes les valeurs doivent être TRUE
-- ============================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='prospects' AND column_name='matching_suppliers')
    AS colonne_matching_suppliers,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prospects_matching_suppliers_max')
    AS borne_50_fournisseurs,
  (SELECT count(*) = 6 FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname IN ('search_catalog','match_catalog_embedding_scoped','distinct_catalog_suppliers',
                      'ozego_similar_key','catalog_variants_by_ozego_key','cheapest_by_ozego_key'))
    AS six_fonctions,
  (SELECT pg_get_constraintdef(oid) LIKE '%ozego-meme%' IS FALSE FROM pg_constraint
    WHERE conname='invoice_lines_validated_stage_check')
    AS plus_de_ozego_meme,
  NOT has_function_privilege('anon','public.search_catalog(text,integer,text[])','execute')
    AS anon_sans_acces,
  public.ozego_similar_key('31.4.72.139') = '4.72.139'
    AS cle_ozego_ok;
