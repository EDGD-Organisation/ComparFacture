CREATE POLICY "invoices_read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'invoices');
CREATE POLICY "invoices_insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'invoices');
CREATE POLICY "invoices_update" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'invoices') WITH CHECK (bucket_id = 'invoices');
CREATE POLICY "invoices_delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'invoices');