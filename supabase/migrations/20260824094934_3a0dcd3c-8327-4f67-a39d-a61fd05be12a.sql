ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS delivery_date date;

ALTER TABLE public.prospects
  ADD d prospects_status_check CHECK (status IN ('todo','in_progress','done'));