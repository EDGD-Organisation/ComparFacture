import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Step, StepId } from "@/lib/stepper";

/**
 * Parcours « Importer, Rapprocher, Comparer » : cercles numérotés reliés, horizontal dès `sm`,
 * vertical sur téléphone. Chaque étape est un vrai bouton (focusable), sauf si elle n'est pas
 * encore activable.
 */
export function ProspectStepper({
  steps,
  onSelect,
}: {
  steps: Step[];
  onSelect: (id: StepId) => void;
}) {
  return (
    <nav aria-label="Parcours du comparatif" className="mb-6">
      <ol className="flex flex-col rounded-lg border border-border bg-card px-3 py-2 sm:flex-row sm:items-center">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <li
              key={step.id}
              className={cn("flex flex-col sm:flex-row sm:items-center", !last && "sm:flex-1")}
            >
              <button
                type="button"
                disabled={!step.enabled}
                aria-current={step.status === "current" ? "step" : undefined}
                onClick={() => onSelect(step.id)}
                className="flex items-center gap-3 rounded-md p-1 text-left ring-offset-background transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
                    step.status === "done" && "border-primary bg-primary text-primary-foreground",
                    step.status === "current" && "border-primary bg-background text-primary",
                    step.status === "upcoming" && "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {step.status === "done" ? <Check className="size-4" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      step.status === "upcoming" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {step.label}
                    {step.status === "done" ? <span className="sr-only"> (terminée)</span> : null}
                  </span>
                  {step.detail ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {step.detail}
                    </span>
                  ) : null}
                </span>
              </button>
              {last ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "ml-[1.1875rem] h-3 w-0.5 sm:ml-0 sm:mx-3 sm:h-0.5 sm:w-auto sm:min-w-6 sm:flex-1",
                    step.status === "done" ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
