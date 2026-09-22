-- Tracks which of the 4 comparison pages (in their fixed left-to-right order —
-- "fournisseur", "ozego-meme", "ozego", "ozego-preferes") validated a line's
-- current match, so the app can lock editing for that line on every later page
-- while still allowing each page to validate its own not-yet-validated lines.
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS validated_stage TEXT
    CHECK (validated_stage IN ('fournisseur', 'ozego-meme', 'ozego', 'ozego-preferes'));
