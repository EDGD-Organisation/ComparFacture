import { supabaseAdmin } from "@/integrations/supabase/client.server";

// The invoice/catalog pipeline reads and writes tables that row-level security restricts to
// admins (and, for processing, runs on behalf of experts who can't read invoice_lines). Callers
// are server functions that check the signed-in user's role first (see auth.server.ts), so this
// uses the service-role client rather than the anon key.
export function serverSupabase() {
  return supabaseAdmin;
}
