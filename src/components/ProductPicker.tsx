import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { euro } from "@/lib/format";
import { stripAccents } from "@/lib/match-normalize";

export type PickedProduct = { id: string; reference: string; label: string; price: number | null };

export function ProductPicker({
  open,
  onOpenChange,
  initialSearch,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSearch: string;
  onPick: (product: PickedProduct) => void;
}) {
  const [search, setSearch] = useState(initialSearch);

  const results = useQuery({
    queryKey: ["product-picker", search],
    enabled: open,
    queryFn: async () => {
      let query = supabase
        .from("catalog_products")
        .select("id, reference, label, price, unit, family")
        .limit(30);
      if (search.trim()) {
        const raw = search.trim();
        const term = `%${raw}%`;
        // label_unaccent so "ECHALOTE" (typed without the accent) still finds "Échalote" —
        // ILIKE folds case but never accents. reference/ean are codes, not accented text.
        const unaccentTerm = `%${stripAccents(raw)}%`;
        query = query.or(
          `reference.ilike.${term},label_unaccent.ilike.${unaccentTerm},ean.ilike.${term}`,
        );
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Rechercher un produit</DialogTitle>
          <DialogDescription>
            Sélectionnez le produit du catalogue correspondant à cette ligne de facture.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-9"
            placeholder="Référence, libellé ou EAN…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {(results.data ?? []).map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => {
                onPick(product);
                onOpenChange(false);
              }}
              className="flex w-full items-center justify-between gap-4 rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-accent/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{product.label}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {product.reference}
                  {product.family ? ` · ${product.family}` : ""}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-sm">{euro(product.price)}</span>
            </button>
          ))}
          {results.data?.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">Aucun produit trouvé.</p>
          ) : null}
        </div>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Fermer
        </Button>
      </DialogContent>
    </Dialog>
  );
}
