-- Renames the roles introduced by 20261007140000: old "admin" -> "expert" (full access) and
-- old "expert" -> "commercial" (create comparatifs + upload invoices only).
--
-- Order matters: the old policies call is_expert(), whose meaning is flipped here, so every
-- policy is dropped BEFORE the functions are redefined and recreated AFTER — otherwise the old
-- "expert" policies would briefly grant the new, full-access expert role. Safe to run on a
-- database that already has the new names (every step is guarded or IF EXISTS).

-- 1. Drop every role-based policy (old and new names).
DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self_or_expert ON public.profiles;

DROP POLICY IF EXISTS admin_all_suppliers ON public.suppliers;
DROP POLICY IF EXISTS admin_all_catalog_products ON public.catalog_products;
DROP POLICY IF EXISTS admin_all_invoices ON public.invoices;
DROP POLICY IF EXISTS admin_all_invoice_lines ON public.invoice_lines;
DROP POLICY IF EXISTS admin_all_product_mappings ON public.product_mappings;
DROP POLICY IF EXISTS admin_all_catalog_sync_runs ON public.catalog_sync_runs;
DROP POLICY IF EXISTS admin_all_app_settings ON public.app_settings;
DROP POLICY IF EXISTS admin_all_prospects ON public.prospects;
DROP POLICY IF EXISTS admin_all_invoices_bucket ON storage.objects;

DROP POLICY IF EXISTS expert_all_suppliers ON public.suppliers;
DROP POLICY IF EXISTS expert_all_catalog_products ON public.catalog_products;
DROP POLICY IF EXISTS expert_all_invoices ON public.invoices;
DROP POLICY IF EXISTS expert_all_invoice_lines ON public.invoice_lines;
DROP POLICY IF EXISTS expert_all_product_mappings ON public.product_mappings;
DROP POLICY IF EXISTS expert_all_catalog_sync_runs ON public.catalog_sync_runs;
DROP POLICY IF EXISTS expert_all_app_settings ON public.app_settings;
DROP POLICY IF EXISTS expert_all_prospects ON public.prospects;
DROP POLICY IF EXISTS expert_all_invoices_bucket ON storage.objects;

DROP POLICY IF EXISTS expert_select_prospects ON public.prospects;
DROP POLICY IF EXISTS expert_insert_prospects ON public.prospects;
DROP POLICY IF EXISTS expert_select_invoices ON public.invoices;
DROP POLICY IF EXISTS expert_insert_invoices ON public.invoices;
DROP POLICY IF EXISTS expert_insert_invoices_bucket ON storage.objects;

DROP POLICY IF EXISTS commercial_select_prospects ON public.prospects;
DROP POLICY IF EXISTS commercial_insert_prospects ON public.prospects;
DROP POLICY IF EXISTS commercial_select_invoices ON public.invoices;
DROP POLICY IF EXISTS commercial_insert_invoices ON public.invoices;
DROP POLICY IF EXISTS commercial_insert_invoices_bucket ON storage.objects;

-- 2. Convert the stored roles (only while the old CHECK constraint is still in place).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%admin%'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
    UPDATE public.profiles
    SET role = CASE role WHEN 'expert' THEN 'commercial' WHEN 'admin' THEN 'expert' ELSE role END;
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check CHECK (role IN ('commercial', 'expert'));
  END IF;
END $$;

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'commercial';

-- 3. Redefine the role helpers.
DROP FUNCTION IF EXISTS public.is_admin();

CREATE OR REPLACE FUNCTION public.is_expert()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'expert' FROM public.profiles WHERE user_id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION public.is_commercial()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'commercial' FROM public.profiles WHERE user_id = auth.uid()), false)
$$;

REVOKE EXECUTE ON FUNCTION public.is_expert(), public.is_commercial() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_expert(), public.is_commercial() TO authenticated;

-- 4. Recreate the policies with the new names.
CREATE POLICY profiles_select_self_or_expert ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_expert());

-- Expert: full access to every table and to the invoices bucket.
CREATE POLICY expert_all_suppliers ON public.suppliers
  FOR ALL TO authenticated USING (public.is_expert()) WITH CHECK (public.is_expert());
CREATE POLICY expert_all_catalog_products ON public.catalog_products
  FOR ALL TO authenticated USING (public.is_expert()) WITH CHECK (public.is_expert());
CREATE POLICY expert_all_invoices ON public.invoices
  FOR ALL TO authenticated USING (public.is_expert()) WITH CHECK (public.is_expert());
CREATE POLICY expert_all_invoice_lines ON public.invoice_lines
  FOR ALL TO authenticated USING (public.is_expert()) WITH CHECK (public.is_expert());
CREATE POLICY expert_all_product_mappings ON public.product_mappings
  FOR ALL TO authenticated USING (public.is_expert()) WITH CHECK (public.is_expert());
CREATE POLICY expert_all_catalog_sync_runs ON public.catalog_sync_runs
  FOR ALL TO authenticated USING (public.is_expert()) WITH CHECK (public.is_expert());
CREATE POLICY expert_all_app_settings ON public.app_settings
  FOR ALL TO authenticated USING (public.is_expert()) WITH CHECK (public.is_expert());
CREATE POLICY expert_all_prospects ON public.prospects
  FOR ALL TO authenticated USING (public.is_expert()) WITH CHECK (public.is_expert());
CREATE POLICY expert_all_invoices_bucket ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'invoices' AND public.is_expert())
  WITH CHECK (bucket_id = 'invoices' AND public.is_expert());

-- Commercial: create comparatifs, upload invoice files, list them. No update/delete, and no
-- access at all to invoice_lines, catalogue, mappings or settings.
-- For now every commercial sees every comparatif. To restrict them to their own later, change
-- commercial_select_prospects' USING clause to `public.is_commercial() AND created_by = auth.uid()`
-- — invoices follow it automatically because they check prospect visibility through that table.
CREATE POLICY commercial_select_prospects ON public.prospects
  FOR SELECT TO authenticated USING (public.is_commercial());
CREATE POLICY commercial_insert_prospects ON public.prospects
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial() AND created_by = auth.uid());

CREATE POLICY commercial_select_invoices ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_commercial() AND EXISTS (SELECT 1 FROM public.prospects p WHERE p.id = prospect_id));
CREATE POLICY commercial_insert_invoices ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial() AND EXISTS (SELECT 1 FROM public.prospects p WHERE p.id = prospect_id));

CREATE POLICY commercial_insert_invoices_bucket ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices' AND public.is_commercial());
