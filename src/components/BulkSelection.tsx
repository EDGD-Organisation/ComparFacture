import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  parseThreshold,
  SCORE_THRESHOLDS,
  type BulkFailure,
  type HeaderCheckState,
} from "@/lib/bulk-validate";

/** Ce qu'un tableau a besoin de savoir pour afficher la colonne de cases à cocher. */
export type RowSelection<L> = {
  isSelectable: (line: L) => boolean;
  isSelected: (line: L) => boolean;
  onToggle: (line: L, checked: boolean) => void;
  headerState: HeaderCheckState;
  onHeaderChange: (checked: boolean) => void;
  headerDisabled: boolean;
};

/** La case « indéterminée » montre un tiret (la coche du composant shadcn ne convient pas). */
const INDETERMINATE_CLASS =
  "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:[&>span]:hidden data-[state=indeterminate]:after:block data-[state=indeterminate]:after:h-0.5 data-[state=indeterminate]:after:w-2 data-[state=indeterminate]:after:rounded-full data-[state=indeterminate]:after:bg-primary-foreground";

export function SelectAllCheckbox({
  state,
  disabled,
  onChange,
}: {
  state: HeaderCheckState;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      checked={state}
      disabled={disabled}
      aria-label="Sélectionner toutes les lignes validables de la page"
      title="Tout cocher sur la page"
      className={INDETERMINATE_CLASS}
      onCheckedChange={(checked) => onChange(checked === true)}
    />
  );
}

export function SelectRowCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      checked={checked}
      disabled={disabled}
      aria-label={`Sélectionner la ligne ${label}`}
      onCheckedChange={(next) => onChange(next === true)}
    />
  );
}

/** Raccourcis de sélection au-dessus du tableau : seuil de score et « toutes les lignes filtrées ». */
export function BulkToolbar({
  threshold,
  onThresholdChange,
  onSelectAboveScore,
  filteredCount,
  selectedCount,
  onSelectAllFiltered,
  disabled,
}: {
  threshold: number;
  onThresholdChange: (value: number) => void;
  onSelectAboveScore: () => void;
  /** Lignes validables parmi les lignes filtrées (toutes pages). */
  filteredCount: number;
  selectedCount: number;
  onSelectAllFiltered: () => void;
  disabled: boolean;
}) {
  if (filteredCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border bg-muted/30 px-4 py-2 text-sm">
      <span className="font-medium">Valider en lot</span>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="bulk-score-threshold" className="font-normal text-muted-foreground">
          Score minimum
        </Label>
        <Select
          value={String(threshold)}
          onValueChange={(value) => onThresholdChange(parseThreshold(value))}
        >
          <SelectTrigger id="bulk-score-threshold" className="h-8 w-24 tabular-nums">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCORE_THRESHOLDS.map((value) => (
              <SelectItem key={value} value={String(value)} className="tabular-nums">
                {Math.round(value * 100)} %
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" disabled={disabled} onClick={onSelectAboveScore}>
          Sélectionner à partir de ce score
        </Button>
      </div>
      {selectedCount < filteredCount ? (
        <Button
          variant="link"
          className="h-auto p-0 tabular-nums"
          disabled={disabled}
          onClick={onSelectAllFiltered}
        >
          Sélectionner les {filteredCount} lignes filtrées
        </Button>
      ) : null}
    </div>
  );
}

/** Barre collante en bas de l'écran tant que la sélection n'est pas vide. */
export function BulkActionBar({
  count,
  progress,
  onValidate,
  onClear,
}: {
  count: number;
  progress: { done: number; total: number } | null;
  onValidate: () => void;
  onClear: () => void;
}) {
  if (count === 0 && !progress) return null;
  const running = progress !== null;
  return (
    <div
      role="region"
      aria-label="Actions sur la sélection"
      className="sticky bottom-4 z-40 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 shadow-lg"
    >
      <p className="text-sm font-medium tabular-nums" aria-live="polite">
        {running
          ? `Validation en cours : ${progress.done} / ${progress.total}`
          : `${count} ${count > 1 ? "lignes sélectionnées" : "ligne sélectionnée"}`}
      </p>
      {running ? (
        <Progress
          className="w-40"
          value={progress.total === 0 ? 0 : (progress.done / progress.total) * 100}
          aria-label="Progression de la validation"
        />
      ) : null}
      <div className="ml-auto flex flex-wrap gap-2">
        <Button disabled={running} onClick={onValidate}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Valider la sélection
        </Button>
        <Button variant="ghost" disabled={running} onClick={onClear}>
          Désélectionner
        </Button>
      </div>
    </div>
  );
}

/** Résumé de la dernière validation en lot, avec le détail des lignes en erreur. */
export function BulkResult({
  summary,
  failures,
  onDismiss,
}: {
  summary: string;
  failures: ReadonlyArray<BulkFailure & { label: string }>;
  onDismiss: () => void;
}) {
  return (
    <div
      role={failures.length > 0 ? "alert" : "status"}
      className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">Dernière validation en lot : {summary}</p>
        {failures.length > 0 ? (
          <ul className="space-y-0.5 text-destructive">
            {failures.map((failure) => (
              <li
                key={failure.id}
                className="truncate"
                title={`${failure.label} : ${failure.message}`}
              >
                {failure.label} : {failure.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Button variant="ghost" size="icon" aria-label="Fermer le résumé" onClick={onDismiss}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
