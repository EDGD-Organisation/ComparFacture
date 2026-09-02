-- The "invoices" Storage bucket (used by comparatifs.$id.tsx uploads and
-- invoices.server.ts downloads) was created manually on the remote project —
-- no migration ever created it, so a fresh environment (e.g. local `supabase
-- start`) had no bucket at all. Idempotent so it's safe on the remote project too.
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Same "open" RLS pattern used everywhere else in this app (e.g. open_prospects) —
-- there is no auth gate, so anon/authenticated both need full access to this bucket.
DROP POLICY IF EXISTS open_invoices_bucket ON storage.objects;
CREATE POLICY open_invoices_bucket ON storage.objects
  FOR ALL
  USING (bucket_id = 'invoices')
  WITH CHECK (bucket_id = 'invoices');
