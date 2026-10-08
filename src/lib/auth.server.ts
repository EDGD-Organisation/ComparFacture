import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type AppRole = "expert" | "admin";

// `supabase` is the user-scoped client from requireSupabaseAuth: it can read the caller's own
// profiles row under RLS, which is all this needs.
export async function requireRole(
  supabase: SupabaseClient<Database>,
  userId: string,
  allowed: readonly AppRole[],
): Promise<AppRole> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const role = data?.role;
  if (role !== "expert" && role !== "admin") throw new Error("Accès refusé : compte sans rôle");
  if (!allowed.includes(role)) throw new Error("Accès refusé : droits insuffisants");
  return role;
}
