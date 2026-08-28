export type ProspectStatus = "todo" | "in_progress" | "done";

type StatusMeta = { value: ProspectStatus; label: string; className: string };

const TODO: StatusMeta = {
  value: "todo",
  label: "À faire",
  className: "bg-muted text-muted-foreground border-border",
};

export const PROSPECT_STATUSES: StatusMeta[] = [
  TODO,
  {
    value: "in_progress",
    label: "En cours",
    className: "bg-primary/10 text-primary border-primary/30",
  },
  {
    value: "done",
    label: "Terminé",
    className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  },
];

export function statusMeta(value: string | null | undefined) {
  return PROSPECT_STATUSES.find((s) => s.value === value) ?? TODO;
}
