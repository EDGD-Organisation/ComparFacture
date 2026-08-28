import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Users } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/format";
import { PROSPECT_STATUSES, statusMeta, type ProspectStatus } from "@/lib/prospect-status";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Comparatifs prospects — comparateur test Ozego" },
      {
        name: "description",
        content:
          "Créez un comparatif par prospect, importez ses factures fournisseurs et mesurez l'écart avec vos tarifs.",
      },
      { property: "og:title", content: "Comparatifs prospects — comparateur test Ozego" },
      {
        property: "og:description",
        content:
          "Un comparatif par prospect : factures importées, lignes rapprochées, écarts chiffrés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProspectsPage,
});

function ProspectsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<ProspectStatus>("todo");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [saving, setSaving] = useState(false);

  const prospectsQuery = useQuery({
    queryKey: ["prospects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .select("*, invoices(count)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  async function create() {
    if (!name.trim()) {
      toast.error("Indiquez le nom du prospect");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("prospects")
      .insert({
        name: name.trim(),
        notes: notes.trim() || null,
        status,
        delivery_date: deliveryDate || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOpen(false);
    setName("");
    setNotes("");
    setStatus("todo");
    setDeliveryDate("");
    queryClient.invalidateQueries({ queryKey: ["prospects"] });
    void navigate({ to: "/comparatifs/$id", params: { id: data.id } });
  }

  async function updateStatus(id: string, value: ProspectStatus) {
    const { error } = await supabase.from("prospects").update({ status: value }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["prospects"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("prospects").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["prospects"] });
    toast.success("Comparatif supprimé");
  }

  const prospects = prospectsQuery.data ?? [];

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Comparatifs</h1>
          <p className="mt-1 text-muted-foreground">
            Créez un comparatif par prospect, puis importez ses factures fournisseurs.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Créer un comparatif
        </Button>
      </div>

      {prospectsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : prospects.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-10 text-center">
            <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucun comparatif. Commencez par créer un comparatif pour un prospect.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {PROSPECT_STATUSES.map((group) => {
            const items = prospects.filter(
              (prospect) => statusMeta(prospect.status).value === group.value,
            );
            return (
              <Card key={group.value}>
                <CardHeader className="flex flex-row items-center gap-3">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${group.className}`}
                  >
                    {group.label}
                  </span>
                  <CardTitle className="font-display text-lg">
                    {items.length} comparatif{items.length > 1 ? "s" : ""}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {items.length === 0 ? (
                    <p className="px-6 pb-6 text-sm text-muted-foreground">
                      Aucun comparatif dans ce groupe.
                    </p>
                  ) : (
                    <div className="divide-y divide-border">
                      {items.map((prospect) => {
                        const count =
                          (prospect.invoices as unknown as Array<{ count: number }>)?.[0]?.count ??
                          0;
                        return (
                          <div
                            key={prospect.id}
                            className="flex flex-wrap items-center gap-4 px-6 py-4"
                          >
                            <div className="min-w-56 flex-1">
                              <Link
                                to="/comparatifs/$id"
                                params={{ id: prospect.id }}
                                className="font-medium hover:text-primary"
                              >
                                {prospect.name}
                              </Link>
                              <p className="text-sm text-muted-foreground">
                                Créé le {shortDate(prospect.created_at)} · {count} facture
                                {count > 1 ? "s" : ""}
                                {prospect.delivery_date
                                  ? ` · Livraison souhaitée le ${shortDate(prospect.delivery_date)}`
                                  : ""}
                              </p>
                              {prospect.notes ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {prospect.notes}
                                </p>
                              ) : null}
                            </div>
                            <Select
                              value={statusMeta(prospect.status).value}
                              onValueChange={(value) =>
                                void updateStatus(prospect.id, value as ProspectStatus)
                              }
                            >
                              <SelectTrigger className="w-40" aria-label="Statut du comparatif">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PROSPECT_STATUSES.map((s) => (
                                  <SelectItem key={s.value} value={s.value}>
                                    {s.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Supprimer le comparatif"
                              onClick={() => void remove(prospect.id)}
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
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Créer un comparatif</DialogTitle>
            <DialogDescription>
              Indiquez le prospect concerné, vous pourrez ensuite importer ses factures.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="prospect-name">Nom du prospect</Label>
              <Input
                id="prospect-name"
                value={name}
                autoFocus
                placeholder="Ex. Boulangerie Martin"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void create()}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="prospect-status">Statut</Label>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as ProspectStatus)}
                >
                  <SelectTrigger id="prospect-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROSPECT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="prospect-delivery">Date de livraison souhaitée</Label>
                <Input
                  id="prospect-delivery"
                  type="date"
                  value={deliveryDate}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prospect-notes">Notes (facultatif)</Label>
              <Textarea
                id="prospect-notes"
                value={notes}
                placeholder="Contact, contexte de la négociation…"
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button disabled={saving} onClick={() => void create()}>
              Créer le comparatif
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
