-- ============================================================================
-- ComparFacture : mise à jour de la base du 2026-11-06 (script unique)
-- ============================================================================
-- À coller tel quel dans Supabase Studio > SQL Editor > Run, sur le projet en ligne.
-- Regroupe 6 migrations de supabase/migrations/ (contenu repris à l'identique), dans l'ordre sûr.
-- Tout-ou-rien (BEGIN/COMMIT) et rejouable sans dégât (tout est idempotent).
-- Ne pas rejouer 20261007140000 ni 20261008100000 : déjà appliquées.
--
-- Effet sur l'application DÉJÀ déployée (ancienne version) : aucun, sauf l'étape 3 : l'ancienne
-- page « Même fournisseur » ne pourra plus valider de ligne (contrainte CHECK resserrée). Cette
-- page est supprimée par la nouvelle version.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ÉTAPE 1/6  fournisseurs de rattachement + droits
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
-- ÉTAPE 2/6  identifiant Ozego tronqué (produits similaires)
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
-- ÉTAPE 3/6  suppression de l'étape « Ozego Même fournisseur »
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

-- ---------------------------------------------------------------------------
-- ÉTAPE 4/6  correctif de performance des fonctions de l'étape 2 (timeout Ozego)
-- (source : supabase/migrations/20261109100000_fix_ozego_key_rpcs_timeout.sql)
-- Doit rester APRÈS l'étape 2 : sinon un rejeu du script réinstallerait la version lente.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- ÉTAPE 5/6  fonction de clé inlinable + index recréé + statistiques (lenteur résiduelle ≈ 1 s)
-- (source : supabase/migrations/20261109110000_ozego_similar_key_inlinable.sql)
-- Doit rester APRÈS les étapes 2 et 4 : sinon un rejeu réinstallerait la version lente.
-- ---------------------------------------------------------------------------

-- Suite de 20261109100000 : les fonctions à clé tronquée restaient lentes en ligne (≈ 1 s par appel,
-- même pour UNE seule clé, contre 50 à 100 ms pour les fonctions à identifiant exact).
--
-- Cause : ozego_similar_key portait `SET search_path` (et STRICT). PostgreSQL n'inline jamais une
-- fonction SQL qui a un SET, ni une fonction STRICT dont le corps contient un CASE : chaque ligne de
-- catalog_products déclenche donc un vrai appel de fonction (≈ 55 µs), soit ≈ 1 s pour 17 800
-- produits dès que le planificateur ne passe pas par l'index. Sans SET ni STRICT, la fonction est
-- remplacée par son expression au moment de la planification : une lecture complète ne coûte plus que
-- quelques dizaines de millisecondes, et l'index d'expression est reconnu de façon fiable.
--
-- Sans danger sans search_path : le corps n'utilise que des fonctions pg_catalog, qualifiées. Le
-- résultat est strictement identique (NULL en entrée donne NULL : strpos(NULL) > 1 est NULL, donc
-- la branche ELSE du CASE s'applique). Les requêtes des RPC répètent déjà `ozego_id IS NOT NULL`,
-- ce qui suffit à prouver la couverture de l'index partiel.
CREATE OR REPLACE FUNCTION public.ozego_similar_key(id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN pg_catalog.strpos(pg_catalog.btrim(id), '.') > 1
      THEN NULLIF(
        pg_catalog.substr(pg_catalog.btrim(id), pg_catalog.strpos(pg_catalog.btrim(id), '.') + 1),
        ''
      )
  END
$$;

-- Index remplacé : le cache de définition des sessions déjà ouvertes (connexions du pool) peut garder
-- l'ancienne forme de l'expression indexée ; ajouter un index force sa relecture.
--
-- Remplacement sans jamais laisser la table sans index : le nouvel index est construit AVANT que
-- l'ancien soit supprimé, puis prend son nom. Aucune donnée n'est touchée (index dérivé, reconstruit
-- depuis catalog_products). Si la transaction échoue, tout est annulé et l'ancien index reste en place.
-- CONCURRENTLY est impossible ici (interdit dans une transaction, ce qu'est l'éditeur SQL Supabase) :
-- la construction bloque les écritures sur catalog_products quelques centaines de ms (17 800 lignes).
-- lock_timeout : si une requête longue tient la table, on abandonne au bout de 10 s au lieu de faire
-- la queue (et de bloquer à leur tour toutes les requêtes suivantes) ; il suffit alors de relancer.
SET LOCAL lock_timeout = '10s';
CREATE INDEX IF NOT EXISTS idx_catalog_products_ozego_similar_key_new
  ON public.catalog_products (public.ozego_similar_key(ozego_id))
  WHERE ozego_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_catalog_products_ozego_similar_key;
ALTER INDEX public.idx_catalog_products_ozego_similar_key_new
  RENAME TO idx_catalog_products_ozego_similar_key;

-- Statistiques à jour, y compris sur l'expression indexée (un import du catalogue de 17 000 produits
-- laisse sinon des estimations périmées qui poussent le planificateur vers une lecture complète).
ANALYZE public.catalog_products;

-- ---------------------------------------------------------------------------
-- ÉTAPE 6/6  fonctions à clé tronquée en SECURITY DEFINER (lenteur résiduelle sous RLS : ≈ 4 s)
-- (source : supabase/migrations/20261110100000_ozego_key_rpcs_security_definer.sql)
-- Doit rester APRÈS les étapes 4 et 5 : sinon un rejeu réinstallerait la version lente.
-- ---------------------------------------------------------------------------

-- Cause (mesurée en ligne avec EXPLAIN ANALYZE, même requête) :
--   rôle de l'éditeur SQL (sans RLS)   :   20 ms,    451 blocs lus
--   rôle `authenticated` (avec RLS)    : 4 038 ms, 40 941 blocs lus (lecture complète de la table)
-- catalog_products est protégée par la politique expert_all_catalog_products (USING is_expert()).
-- Sous RLS, PostgreSQL n'autorise une condition utilisateur à servir de condition d'index que si
-- toutes ses fonctions sont « leakproof » : btrim, substr et ozego_similar_key ne le sont pas
-- (pg_proc.proleakproof = false), et un rôle non superutilisateur ne peut pas les marquer. L'index
-- sur ozego_similar_key(ozego_id) n'est donc jamais utilisé par l'application, alors qu'il l'est dès
-- que la RLS est contournée. La comparaison d'égalité de texte, elle, est leakproof : c'est pourquoi
-- les fonctions à identifiant exact restent rapides.
--
-- Correctif : les deux fonctions passent en SECURITY DEFINER (la RLS n'est plus appliquée ligne par
-- ligne) et reprennent la règle de la politique en garde explicite : `WHERE public.is_expert()`.
-- Visibilité inchangée : seuls les experts voient des lignes, exactement comme avec la politique
-- (un autre rôle reçoit un résultat vide). `is_expert()` n'a aucun argument ni colonne : la garde
-- est évaluée une seule fois par appel. Même schéma que distinct_catalog_suppliers
-- (20261106150000). search_path reste fixé, droits d'exécution inchangés (pas d'accès pour anon).
--
-- Un appelant en service_role (sans JWT utilisateur) recevrait donc un résultat vide : aucun
-- appelant de ce type aujourd'hui (seul le client navigateur utilise ces fonctions).
--
-- Signatures, colonnes et valeurs de retour identiques : sans effet sur le code applicatif. Aucune
-- donnée ni index n'est modifié (pas de réécriture de la table, qui porte des index HNSW et GIN).

CREATE OR REPLACE FUNCTION public.catalog_variants_by_ozego_key(keys text[])
RETURNS TABLE(ozego_id text, id uuid, reference text, label text, ean text, family text, unit text, price numeric, supplier_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.ozego_id, p.id, p.reference, p.label, p.ean, p.family, p.unit, p.price, p.supplier_name
  FROM public.catalog_products p
  WHERE public.is_expert()
    AND p.is_active
    AND p.price IS NOT NULL
    AND p.ozego_id IS NOT NULL
    AND public.ozego_similar_key(p.ozego_id) = ANY(keys);
$$;

CREATE OR REPLACE FUNCTION public.cheapest_by_ozego_key(keys text[])
RETURNS TABLE(ozego_id text, id uuid, reference text, label text, ean text, family text, unit text, price numeric, supplier_name text, variants_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH hits AS (
    SELECT p.ozego_id, p.id, p.reference, p.label, p.ean, p.family, p.unit, p.price, p.supplier_name,
           public.ozego_similar_key(p.ozego_id) AS k
    FROM public.catalog_products p
    WHERE public.is_expert()
      AND p.is_active
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

-- Droits : CREATE OR REPLACE conserve les droits existants ; ils sont ré-affirmés pour que la
-- migration se suffise à elle-même (jamais d'accès pour anon).
REVOKE EXECUTE ON FUNCTION
  public.catalog_variants_by_ozego_key(text[]),
  public.cheapest_by_ozego_key(text[])
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.catalog_variants_by_ozego_key(text[]),
  public.cheapest_by_ozego_key(text[])
TO authenticated, service_role;

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
    AS cle_ozego_ok,
  (SELECT count(*) = 2 AND bool_and(prosecdef) FROM pg_proc
    WHERE pronamespace='public'::regnamespace
      AND proname IN ('catalog_variants_by_ozego_key','cheapest_by_ozego_key'))
    AS fonctions_cle_security_definer;
