DELETE FROM public.product_mappings;
UPDATE public.invoice_lines SET matched_product_id = NULL, match_status = 'unmatched', match_score = NULL, manual_override = false WHERE matched_product_id IN (SELECT id FROM public.catalog_products WHERE source <> 'demo');
DELETE FROM public.catalog_products WHERE source <> 'demo';