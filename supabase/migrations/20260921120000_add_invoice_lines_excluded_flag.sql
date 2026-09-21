-- Lets a user hide a single extracted invoice line from every comparison view
-- (référence fournisseur + the 3 Ozego tables) without deleting the row — keeps
-- the underlying extraction data in case the hide was a mistake, while correctly
-- dropping the line from all totals/gap calculations that read it.
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false;
