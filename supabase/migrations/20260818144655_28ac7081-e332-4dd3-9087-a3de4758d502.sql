delete from product_mappings where supplier_name ilike 'BATIPRO%';
delete from invoice_lines where invoice_id in (select id from invoices where prospect_id = '1762e837-8036-4a5e-b800-f8fe30e9fb2d');
delete from invoices where prospect_id = '1762e837-8036-4a5e-b800-f8fe30e9fb2d';
delete from prospects where id = '1762e837-8036-4a5e-b800-f8fe30e9fb2d';