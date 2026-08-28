import { Link } from "@tanstack/react-router";
import { FileText, Package, Settings, ScanLine } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Comparatifs", icon: FileText },
  { to: "/catalogue", label: "Catalogue", icon: Package },
  { to: "/reglages", label: "Réglages", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
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
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
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
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
