import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RoleSchema = z.enum(["commercial", "expert"]);

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole } = await import("./auth.server");
    await requireRole(context.supabase, context.userId, ["expert"]);
    const users = await import("./users.server");
    return users.listUsers();
  });

const CreateUserInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: RoleSchema,
});

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateUserInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./auth.server");
    await requireRole(context.supabase, context.userId, ["expert"]);
    const users = await import("./users.server");
    return users.createUser(data);
  });

const SetRoleInput = z.object({ userId: z.string().uuid(), role: RoleSchema });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetRoleInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./auth.server");
    await requireRole(context.supabase, context.userId, ["expert"]);
    if (data.userId === context.userId)
      throw new Error("Vous ne pouvez pas changer votre propre rôle");
    const users = await import("./users.server");
    await users.setUserRole(data.userId, data.role);
    return { saved: true };
  });

const DeleteUserInput = z.object({ userId: z.string().uuid() });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteUserInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./auth.server");
    await requireRole(context.supabase, context.userId, ["expert"]);
    if (data.userId === context.userId)
      throw new Error("Vous ne pouvez pas supprimer votre propre compte");
    const users = await import("./users.server");
    await users.deleteUser(data.userId);
    return { deleted: true };
  });
