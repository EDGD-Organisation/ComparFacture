import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { syncCatalogFromErp } from "@/lib/catalog.functions";
import { euro, shortDate } from "@/lib/format";
import { stripAccents } from "@/lib/match-normalize";

export const Route = createFileRoute("/catalogue")({
  head: () => ({
    meta: [
      { title: "Catalogue produits — comparateur test Ozego" },
      {
        name: "description",
        content:
          "Consultez le catalogue produits de référence et actualisez-le depuis l'API pour comparer les prix facturés.",
      },
      { property: "og:title", content: "Catalogue produits — comparateur test Ozego" },
      {
        property: "og:description",
        content: "Catalogue de référence actualisable depuis l'API produits.",
      },
    ],
  }),
  component: CatalogPage,
});

function CatalogPage() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const runSync = useServerFn(syncCatalogFromErp);

  const productsQuery = useQuery({
    queryKey: ["catalog", search],
    queryFn: async () => {
      let query = supabase
        .from("catalog_products")
        .select(
          "id, reference, label, ean, price, unit, family, ozego_id, supplier_name, updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(100);
      if (search.trim()) {
        const raw = search.trim();
        const term = `%${raw}%`;
        // label_unaccent so "ECHALOTE" (typed without the accent) still finds "Échalote" —
        // ILIKE folds case but never accents. reference/ean/ozego_id are codes, not accented text.
        const unaccentTerm = `%${stripAccents(raw)}%`;
        query = query.or(
          `reference.ilike.${term},label_unaccent.ilike.${unaccentTerm},ean.ilike.${term},ozego_id.ilike.${term}`,
        );
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const countQuery = useQuery({
    queryKey: ["catalog-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("catalog_products")
        .select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });

  const sync = useMutation({
    mutationFn: () => runSync({ data: {} }),
    onSuccess: (result) => {
      toast.success(
        `Synchronisation terminée : ${result.inserted} ajouts, ${result.updated} mises à jour`,
      );
      queryClient.invalidateQueries({ queryKey: ["catalog"] });
      queryClient.invalidateQueries({ queryKey: ["catalog-count"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold">Catalogue produits</h1>
        <p className="mt-1 text-muted-foreground">
          Référentiel de prix utilisé pour comparer chaque ligne de facture.
        </p>
      </div>

      <div className="mb-8">
        <Button disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Actualiser le catalogue
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="font-display text-lg">
            {countQuery.data ?? 0} produits en base
          </CardTitle>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Rechercher…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Référence</th>
                  <th className="px-6 py-3 font-medium">Identifiant Ozego</th>
                  <th className="px-6 py-3 font-medium">Libellé</th>
                  <th className="px-6 py-3 font-medium">Fournisseur</th>
                  <th className="px-6 py-3 font-medium">EAN</th>
                  <th className="px-6 py-3 text-right font-medium">Prix</th>
                  <th className="px-6 py-3 font-medium">Mis à jour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(productsQuery.data ?? []).map((product) => (
                  <tr key={product.id}>
                    <td className="px-6 py-3 font-mono text-xs">{product.reference}</td>
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground">
                      {product.ozego_id || "—"}
                    </td>
                    <td className="px-6 py-3">{product.label}</td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {product.supplier_name || "—"}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground">
                      {product.ean || "—"}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums">{euro(product.price)}</td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {shortDate(product.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {productsQuery.data?.length === 0 ? (
              <p className="px-6 py-6 text-sm text-muted-foreground">Aucun produit.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
