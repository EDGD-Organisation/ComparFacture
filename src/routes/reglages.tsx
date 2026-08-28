import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reglages")({
  head: () => ({
    meta: [
      { title: "Réglages du rapprochement — comparateur test Ozego" },
      {
        name: "description",
        content:
          "Ajustez les seuils de rapprochement automatique et la tolérance d'écart de prix appliquée aux factures.",
      },
      { property: "og:title", content: "Réglages du rapprochement — comparateur test Ozego" },
      {
        property: "og:description",
        content: "Seuils de confiance du matching et tolérance d'écart de prix.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ auto: 0.9, review: 0.6, tolerance: 2 });
  const [saving, setSaving] = useState(false);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("*").maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  useEffect(() => {
    if (settings.data) {
      setForm({
        auto: settings.data.auto_confirm_score,
        review: settings.data.review_score,
        tolerance: settings.data.tolerance_percent,
      });
    }
  }, [settings.data]);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("app_settings").upsert({
      id: true,
      auto_confirm_score: form.auto,
      review_score: form.review,
      tolerance_percent: form.tolerance,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Réglages enregistrés");
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold">Réglages</h1>
        <p className="mt-1 text-muted-foreground">
          Paramètres du rapprochement automatique et de la détection des écarts.
        </p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="font-display text-base">Seuils</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="auto">Score de validation automatique</Label>
            <Input
              id="auto"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={form.auto}
              onChange={(event) => setForm({ ...form, auto: Number(event.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              Au-dessus de ce score, la correspondance est considérée comme fiable.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="review">Score minimum de proposition</Label>
            <Input
              id="review"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={form.review}
              onChange={(event) => setForm({ ...form, review: Number(event.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              En dessous, la ligne est marquée « à rapprocher manuellement ».
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tolerance">Tolérance d'écart de prix (%)</Label>
            <Input
              id="tolerance"
              type="number"
              step="0.5"
              min="0"
              value={form.tolerance}
              onChange={(event) => setForm({ ...form, tolerance: Number(event.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              Un écart inférieur à cette valeur n'est pas signalé comme anomalie.
            </p>
          </div>
          <Button onClick={() => void save()} disabled={saving}>
            Enregistrer
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
