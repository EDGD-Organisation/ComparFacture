-- 20260824094934_3a0dcd3c-8327-4f67-a39d-a61fd05be12a.sql has a typo
-- ("ADD d prospects_status_check CHECK (...)" instead of "ADD CONSTRAINT ...") that
-- makes that statement a hard Postgres syntax/semantic error (SQLSTATE 42704) — it
-- cannot have succeeded anywhere it was replayed, including on the linked remote
-- project, so prospects.status has never actually had this CHECK constraint. Left
-- as-is (not editing that file/history); this migration adds the missing pieces
-- idempotently so it's safe to apply on top of any environment, whether or not the
-- broken statement partially ran there.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS delivery_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospects_status_check'
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_status_check CHECK (status IN ('todo','in_progress','done'));
  END IF;
END $$;
