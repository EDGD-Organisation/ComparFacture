import type { ReactNode } from "react";

import { TabCount } from "@/components/TabCount";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type SectionTabItem<T extends string> = {
  id: T;
  label: string;
  /** Compteur de l'onglet : `null` tant qu'il est inconnu (réserve la place), absent = pas de pastille. */
  count?: number | null;
  countTitle?: string | undefined;
};

/**
 * Onglets de section contrôlés (valeur dans l'URL). Construits sur Radix : rôles tablist / tab /
 * tabpanel, flèches, Début et Fin. L'activation est manuelle (Entrée ou Espace) : parcourir les
 * onglets aux flèches ne crée pas une entrée d'historique par onglet survolé. `children` est
 * rendu sous la liste ; y placer un `SectionTabPanel` pour le contenu (seul le panneau actif est
 * monté).
 */
export function SectionTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  label,
  className,
  listClassName,
  children,
}: {
  tabs: ReadonlyArray<SectionTabItem<T>>;
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  className?: string;
  listClassName?: string;
  children: ReactNode;
}) {
  return (
    <Tabs
      value={value}
      activationMode="manual"
      className={className}
      onValueChange={(next) => {
        const tab = tabs.find((item) => item.id === next);
        if (tab) onValueChange(tab.id);
      }}
    >
      <TabsList
        aria-label={label}
        className={cn(
          "flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1 [scrollbar-width:thin]",
          listClassName,
        )}
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className="shrink-0 px-4 py-2 focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:shadow-sm"
          >
            {tab.label}
            {tab.count !== undefined ? <TabCount value={tab.count} title={tab.countTitle} /> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}

/** Panneau de l'onglet `value` : n'existe dans la page que lorsque cet onglet est actif. */
export function SectionTabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TabsContent value={value} className={cn("mt-0", className)}>
      {children}
    </TabsContent>
  );
}
