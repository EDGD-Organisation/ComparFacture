-- Authentication roles: "expert" (creates comparatifs + uploads invoice files only) and
-- "admin" (everything an expert can do, plus matching/validation, catalogue, settings and
-- user management). Replaces the previous wide-open anon policies.
--
-- NOTE: the roles were renamed right after this was applied (admin -> expert, expert ->
-- commercial) by 20261008100000_rename_roles_expert_commercial.sql — don't edit this file.
--
-- WARNING: once applied, the app is unreachable without a signed-in user that has a row in
-- public.profiles. Create the first admin right after applying (see HANDOFF.md).

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  role text NOT NULL DEFAULT 'expert' CHECK (role IN ('expert', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- SECURITY DEFINER so the role lookup itself isn't subject to profiles' own RLS (which
-- would make every policy below recurse into it).
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'admin' FROM public.profiles WHERE user_id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION public.is_expert()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'expert' FROM public.profiles WHERE user_id = auth.uid()), false)
$$;

REVOKE EXECUTE ON FUNCTION public.current_app_role(), public.is_admin(), public.is_expert() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_app_role(), public.is_admin(), public.is_expert() TO authenticated;

CREATE POLICY profiles_select_self_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ---------------------------------------------------------------------------
-- Prospects (comparatifs): remember who created each one
-- ---------------------------------------------------------------------------
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL DEFAULT auth.uid();

-- ---------------------------------------------------------------------------
-- Drop every "open" policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS open_suppliers ON public.suppliers;
DROP POLICY IF EXISTS open_catalog_products ON public.catalog_products;
DROP POLICY IF EXISTS open_invoices ON public.invoices;
DROP POLICY IF EXISTS open_invoice_lines ON public.invoice_lines;
DROP POLICY IF EXISTS open_product_mappings ON public.product_mappings;
DROP POLICY IF EXISTS open_catalog_sync_runs ON public.catalog_sync_runs;
DROP POLICY IF EXISTS open_app_settings ON public.app_settings;
DROP POLICY IF EXISTS open_prospects ON public.prospects;

DROP POLICY IF EXISTS invoices_read ON storage.objects;
DROP POLICY IF EXISTS invoices_insert ON storage.objects;
DROP POLICY IF EXISTS invoices_update ON storage.objects;
DROP POLICY IF EXISTS invoices_delete ON storage.objects;
DROP POLICY IF EXISTS open_invoices_bucket ON storage.objects;

-- ---------------------------------------------------------------------------
-- Admin: full access to every table and to the invoices bucket
-- ---------------------------------------------------------------------------
CREATE POLICY admin_all_suppliers ON public.suppliers
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all_catalog_products ON public.catalog_products
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all_invoices ON public.invoices
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all_invoice_lines ON public.invoice_lines
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all_product_mappings ON public.product_mappings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all_catalog_sync_runs ON public.catalog_sync_runs
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all_app_settings ON public.app_settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all_prospects ON public.prospects
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all_invoices_bucket ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'invoices' AND public.is_admin())
  WITH CHECK (bucket_id = 'invoices' AND public.is_admin());

-- ---------------------------------------------------------------------------
-- Expert: create comparatifs, upload invoice files, list them. No update/delete, and no
-- access at all to invoice_lines, catalogue, mappings or settings.
-- ---------------------------------------------------------------------------
-- For now every expert sees every comparatif. To restrict experts to their own later, change
-- this policy's USING clause to `public.is_expert() AND created_by = auth.uid()` — invoices
-- below follow it automatically because they check prospect visibility through this table.
CREATE POLICY expert_select_prospects ON public.prospects
  FOR SELECT TO authenticated USING (public.is_expert());
CREATE POLICY expert_insert_prospects ON public.prospects
  FOR INSERT TO authenticated
  WITH CHECK (public.is_expert() AND created_by = auth.uid());

CREATE POLICY expert_select_invoices ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_expert() AND EXISTS (SELECT 1 FROM public.prospects p WHERE p.id = prospect_id));
CREATE POLICY expert_insert_invoices ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.is_expert() AND EXISTS (SELECT 1 FROM public.prospects p WHERE p.id = prospect_id));

CREATE POLICY expert_insert_invoices_bucket ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices' AND public.is_expert());
