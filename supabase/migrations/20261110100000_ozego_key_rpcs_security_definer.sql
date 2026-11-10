-- Suite de 20261109110000 : les fonctions à clé tronquée restaient lentes en ligne (≈ 0,7 s, 2,5 s à
-- froid) alors que les fonctions à identifiant exact répondent en 50 à 90 ms.
--
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
