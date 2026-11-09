import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { ListRowsSkeleton } from "@/components/LoadingSkeletons";
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
import { checkNewUser, missingHelp, visibleError } from "@/lib/new-user-form";
import { toastError } from "@/lib/toast-error";
import { createUser, deleteUser, listUsers, setUserRole } from "@/lib/users.functions";

export const Route = createFileRoute("/utilisateurs")({
  head: () => ({
    meta: [{ title: "Utilisateurs — comparateur test Ozego" }],
  }),
  component: UsersPage,
});

const ROLE_LABEL: Record<AppRole, string> = { commercial: "Commercial", expert: "Expert" };

function UsersPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const runList = useServerFn(listUsers);
  const runCreate = useServerFn(createUser);
  const runSetRole = useServerFn(setUserRole);
  const runDelete = useServerFn(deleteUser);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("commercial");
  const [touched, setTouched] = useState({ email: false, password: false });
  const check = checkNewUser({ email, password });
  const help = missingHelp(check);
  const emailError = visibleError(check.emailError, touched.email);
  const passwordError = visibleError(check.passwordError, touched.password);

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
      setRole("commercial");
      setTouched({ email: false, password: false });
      void refresh();
    },
    onError: (error: Error) => toastError(error),
  });

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: AppRole }) => runSetRole({ data: input }),
    onSuccess: () => void refresh(),
    onError: (error: Error) => toastError(error),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => runDelete({ data: { userId } }),
    onSuccess: () => {
      toast.success("Compte supprimé");
      void refresh();
    },
    onError: (error: Error) => toastError(error),
  });

  const users = usersQuery.data ?? [];

  return (
    <AppShell expertOnly>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold">Utilisateurs</h1>
        <p className="mt-1 text-muted-foreground">
          Un commercial crée des comparatifs et importe des factures. Un expert fait en plus le
          rapprochement et gère le catalogue, les réglages et les comptes.
        </p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="font-display text-lg">Créer un compte</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
          <div className="grid gap-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              value={email}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "new-user-email-error" : undefined}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setTouched((previous) => ({ ...previous, email: true }))}
            />
            {emailError ? (
              <p id="new-user-email-error" className="text-xs text-destructive">
                {emailError}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-user-password">Mot de passe (8 caractères min.)</Label>
            <Input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "new-user-password-error" : undefined}
              onChange={(event) => setPassword(event.target.value)}
              onBlur={() => setTouched((previous) => ({ ...previous, password: true }))}
            />
            {passwordError ? (
              <p id="new-user-password-error" className="text-xs text-destructive">
                {passwordError}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-user-role">Rôle</Label>
            <Select value={role} onValueChange={(value) => setRole(value as AppRole)}>
              <SelectTrigger id="new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="commercial">{ROLE_LABEL.commercial}</SelectItem>
                <SelectItem value="expert">{ROLE_LABEL.expert}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <span aria-hidden="true" className="invisible text-sm leading-none max-lg:hidden">
              &nbsp;
            </span>
            <Button
              disabled={create.isPending || !check.valid}
              aria-describedby={help ? "new-user-help" : undefined}
              onClick={() => create.mutate()}
            >
              <UserPlus className="size-4" />
              Créer le compte
            </Button>
          </div>
          <p
            id="new-user-help"
            aria-live="polite"
            className="text-sm text-muted-foreground empty:hidden sm:col-span-2 lg:col-span-4"
          >
            {help}
          </p>
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
            <ListRowsSkeleton rows={3} />
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
                        <SelectItem value="commercial">{ROLE_LABEL.commercial}</SelectItem>
                        <SelectItem value="expert">{ROLE_LABEL.expert}</SelectItem>
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
