import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, LogOut, Package, ScanLine, Settings, UserCog } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const NAV = [
  { to: "/", label: "Comparatifs", icon: FileText, expertOnly: false },
  { to: "/catalogue", label: "Catalogue", icon: Package, expertOnly: true },
  { to: "/reglages", label: "Réglages", icon: Settings, expertOnly: true },
  { to: "/utilisateurs", label: "Utilisateurs", icon: UserCog, expertOnly: true },
] as const;

export function AppShell({
  children,
  expertOnly = false,
}: {
  children: ReactNode;
  expertOnly?: boolean;
}) {
  const { session, email, role, isExpert, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/connexion" });
  }, [loading, session, navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    queryClient.clear();
    void navigate({ to: "/connexion" });
  }

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ScanLine className="size-5" />
            </span>
            <span className="font-display text-base font-semibold tracking-tight">
              comparateur test <span className="text-primary">Ozego</span>
            </span>
          </Link>
          <nav className="flex flex-1 items-center gap-1">
            {NAV.filter((item) => isExpert || !item.expertOnly).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground [&.active]:bg-secondary [&.active]:text-foreground"
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-right text-xs leading-tight text-muted-foreground sm:block">
              {email}
              <span className="block font-medium text-foreground">
                {role === "expert" ? "Expert" : role === "commercial" ? "Commercial" : ""}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              title="Se déconnecter"
              onClick={() => void signOut()}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {!role ? (
          <Card>
            <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
              Ce compte n'a pas encore de rôle. Contactez un expert.
            </CardContent>
          </Card>
        ) : expertOnly && !isExpert ? (
          <Card>
            <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
              Cette page est réservée aux experts.
            </CardContent>
          </Card>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
