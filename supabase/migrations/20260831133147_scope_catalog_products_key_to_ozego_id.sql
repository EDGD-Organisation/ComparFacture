-- catalog_products_reference_key was scoped to (supplier_name, reference), assuming a
-- supplier's reference code is unique per product. Confirmed false against oze-back's
-- real live catalog: 130 cases where the same supplier reuses the same supplier_ref for
-- genuinely different products (e.g. "france frais" / ref "190016" is both "Chaource AOP
-- 250g" and "Époisse 250g"). This broke syncCatalogFromErp with a duplicate-key error as
-- soon as the two collided in the same import.
--
-- ozego_id is oze-back's actual per-product identity (its own grouping key), so it's the
-- correct uniqueness scope per supplier. Manual CSV import (importCatalog) doesn't always
-- provide an ozego_id, so fall back to reference when it's null — same behavior as before
-- for that path, fixed behavior for the ERP sync path.
DROP INDEX IF EXISTS public.catalog_products_reference_key;
CREATE UNIQUE INDEX catalog_products_reference_key
  ON public.catalog_products (
    coalesce(lower(supplier_name), ''),
    coalesce(lower(ozego_id), lower(reference))
  );
