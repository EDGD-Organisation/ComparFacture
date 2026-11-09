-- The "Ozego · Même fournisseur" page was removed. Lines validated there
-- ("ozego-meme") were already locked on "ozego" and "ozego-preferes", exactly
-- like lines validated on "fournisseur", so they are moved to "fournisseur".
UPDATE public.invoice_lines
SET validated_stage = 'fournisseur'
WHERE validated_stage = 'ozego-meme';

DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.invoice_lines'::regclass
      AND c.contype = 'c'
      AND a.attname = 'validated_stage'
  LOOP
    EXECUTE format('ALTER TABLE public.invoice_lines DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_validated_stage_check
    CHECK (validated_stage IN ('fournisseur', 'ozego', 'ozego-preferes'));
