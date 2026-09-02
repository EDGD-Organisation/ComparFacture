-- !!! LOCAL-ONLY — DO NOT APPLY TO THE REMOTE/PRODUCTION PROJECT !!!
--
-- Switches catalog_products.embedding from OpenAI's text-embedding-3-small
-- (1536-dim, via the Lovable AI Gateway — needs LOVABLE_API_KEY, unavailable in
-- local dev) to a fully local model: Xenova/multilingual-e5-small via
-- @huggingface/transformers (384-dim, no API key, no network call). See
-- src/lib/embeddings.server.ts for the model choice rationale and the required
-- "query: " prefix convention.
--
-- This is a ONE-WAY, BREAKING change for any environment that already has real
-- 1536-dim embeddings (i.e. the remote Lovable Cloud project) — applying it there
-- would either fail outright or, if forced, permanently destroy those embeddings.
-- It's only safe here because local catalog_products.embedding is 100% NULL
-- (confirmed before writing this migration — embeddings always failed locally
-- pre-existing, since the Lovable Gateway was never reachable in local dev).
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
