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

-- Index recréé : le cache de définition des sessions déjà ouvertes (connexions du pool) peut garder
-- l'ancienne forme de l'expression indexée ; recréer l'index force sa relecture.
DROP INDEX IF EXISTS public.idx_catalog_products_ozego_similar_key;
CREATE INDEX idx_catalog_products_ozego_similar_key
  ON public.catalog_products (public.ozego_similar_key(ozego_id))
  WHERE ozego_id IS NOT NULL;

-- Statistiques à jour, y compris sur l'expression indexée (un import du catalogue de 17 000 produits
-- laisse sinon des estimations périmées qui poussent le planificateur vers une lecture complète).
ANALYZE public.catalog_products;
