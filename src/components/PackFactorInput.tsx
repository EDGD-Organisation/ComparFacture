import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { normalizePackFactor } from "@/lib/pack";

export function PackFactorInput({
  value,
  onSave,
}: {
  value: number;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = normalizePackFactor(draft);
    setDraft(String(next));
    if (next !== value) onSave(next);
  };

  return (
    <Input
      value={draft}
      inputMode="decimal"
      placeholder="1"
      title="Nombre d'unités catalogue par unité facturée (1 par défaut)"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      className="ml-auto h-8 w-16 text-right tabular-nums"
    />
  );
}
