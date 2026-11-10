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
import { PICKER_LIMIT, searchTokens, tokenFilter } from "@/lib/picker-search";

export type PickedProduct = { id: string; reference: string; label: string; price: number | null };

type PickerRow = PickedProduct & { family: string | null };

export function ProductPicker({
  open,
  onOpenChange,
  initialSearch,
  supplierReference,
  supplierLabel,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSearch: string;
  /** Référence fournisseur de la ligne de facture : proposée comme terme de recherche. */
  supplierReference?: string | null;
  /** Désignation fournisseur de la ligne de facture : proposée comme terme de recherche. */
  supplierLabel?: string | null;
  onPick: (product: PickedProduct) => void;
}) {
  const [search, setSearch] = useState(initialSearch);

  const suggestions = [
    { key: "reference", title: "Référence fournisseur", value: supplierReference?.trim() ?? "" },
    { key: "label", title: "Désignation fournisseur", value: supplierLabel?.trim() ?? "" },
  ].filter((suggestion) => suggestion.value !== "");

  const results = useQuery({
    queryKey: ["product-picker", search],
    enabled: open,
    queryFn: async (): Promise<PickerRow[]> => {
      const tokens = searchTokens(search);
      let query = supabase
        .from("catalog_products")
        .select("id, reference, label, price, unit, family")
        .limit(PICKER_LIMIT);
      for (const token of tokens) query = query.or(tokenFilter(token));
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      if (data.length > 0 || tokens.length < 2) return data;
      // Aucun produit ne contient tous les mots (désignation de facture très différente du libellé
      // catalogue) : repli sur la similarité du catalogue, classée par score.
      const similar = await supabase.rpc("search_catalog", {
        q: tokens.join(" "),
        max_results: PICKER_LIMIT,
      });
      if (similar.error) throw new Error(similar.error.message);
      return similar.data.map((product) => ({
        id: product.id,
        reference: product.reference,
        label: product.label,
        price: product.price ?? null,
        family: null,
      }));
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
            placeholder="Référence, désignation, libellé ou EAN…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {suggestions.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Rechercher avec les données de la ligne de facture"
          >
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion.key}
                type="button"
                size="sm"
                variant={search.trim() === suggestion.value ? "secondary" : "outline"}
                className="h-auto min-w-0 max-w-full justify-start gap-2 py-1"
                title={suggestion.value}
                onClick={() => setSearch(suggestion.value)}
              >
                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                  {suggestion.title}
                </span>
                <span className="truncate">{suggestion.value}</span>
              </Button>
            ))}
          </div>
        ) : null}
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
