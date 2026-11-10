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
