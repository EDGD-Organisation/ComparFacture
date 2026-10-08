import { supabaseAdmin } from "@/integrations/supabase/client.server";

import type { AppRole } from "./auth.server";

export async function listUsers() {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, email, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

export async function createUser(input: { email: string; password: string; role: AppRole }) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "Création du compte impossible");

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .insert({ user_id: data.user.id, email: input.email, role: input.role });
  if (profileError) {
    // Don't leave an auth user with no role (it could sign in but would be locked out).
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    throw new Error(profileError.message);
  }
  return { userId: data.user.id };
}

export async function setUserRole(userId: string, role: AppRole) {
  const { error } = await supabaseAdmin.from("profiles").update({ role }).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function deleteUser(userId: string) {
  // profiles row goes with it (ON DELETE CASCADE).
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}
