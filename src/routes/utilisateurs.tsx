import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, type AppRole } from "@/lib/auth";
import { shortDate } from "@/lib/format";
import { createUser, deleteUser, listUsers, setUserRole } from "@/lib/users.functions";

export const Route = createFileRoute("/utilisateurs")({
  head: () => ({
    meta: [{ title: "Utilisateurs — comparateur test Ozego" }],
  }),
  component: UsersPage,
});

const ROLE_LABEL: Record<AppRole, string> = { expert: "Expert", admin: "Administrateur" };

function UsersPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const runList = useServerFn(listUsers);
  const runCreate = useServerFn(createUser);
  const runSetRole = useServerFn(setUserRole);
  const runDelete = useServerFn(deleteUser);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("expert");

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => runList(),
    enabled: Boolean(session),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: () => runCreate({ data: { email: email.trim(), password, role } }),
    onSuccess: () => {
      toast.success("Compte créé");
      setEmail("");
      setPassword("");
      setRole("expert");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: AppRole }) => runSetRole({ data: input }),
    onSuccess: () => void refresh(),
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => runDelete({ data: { userId } }),
    onSuccess: () => {
      toast.success("Compte supprimé");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const users = usersQuery.data ?? [];

  return (
    <AppShell adminOnly>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold">Utilisateurs</h1>
        <p className="mt-1 text-muted-foreground">
          Un expert crée des comparatifs et importe des factures. Un administrateur fait en plus le
          rapprochement et gère le catalogue, les réglages et les comptes.
        </p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="font-display text-lg">Créer un compte</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <div className="grid gap-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-user-password">Mot de passe (8 caractères min.)</Label>
            <Input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-user-role">Rôle</Label>
            <Select value={role} onValueChange={(value) => setRole(value as AppRole)}>
              <SelectTrigger id="new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expert">{ROLE_LABEL.expert}</SelectItem>
                <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={create.isPending || !email.trim() || password.length < 8}
            onClick={() => create.mutate()}
          >
            <UserPlus className="size-4" />
            Créer le compte
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">
            {users.length} compte{users.length > 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {usersQuery.isLoading ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <div className="divide-y divide-border">
              {users.map((user) => {
                const isSelf = user.user_id === session?.user.id;
                return (
                  <div key={user.user_id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                    <div className="min-w-56 flex-1">
                      <p className="font-medium">{user.email}</p>
                      <p className="text-sm text-muted-foreground">
                        Créé le {shortDate(user.created_at)}
                        {isSelf ? " · vous" : ""}
                      </p>
                    </div>
                    <Select
                      value={user.role}
                      disabled={isSelf}
                      onValueChange={(value) =>
                        changeRole.mutate({ userId: user.user_id, role: value as AppRole })
                      }
                    >
                      <SelectTrigger className="w-48" aria-label="Rôle">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expert">{ROLE_LABEL.expert}</SelectItem>
                        <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Supprimer le compte"
                      disabled={isSelf}
                      onClick={() => {
                        if (window.confirm(`Supprimer le compte ${user.email} ?`))
                          remove.mutate(user.user_id);
                      }}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
