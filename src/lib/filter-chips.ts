import { ALL, STATUS_LABEL, type MatchingFilters } from "./matching-view";

export type FilterChip = {
  key: "search" | "status" | "invoiceId" | "supplier" | "validation";
  /** Texte de la pastille, ex. « Statut : À vérifier ». */
  label: string;
  /** Changement de filtres qui retire cette pastille (et elle seule). */
  patch: Partial<MatchingFilters>;
};

const VALIDATION_LABEL = {
  validated: "Lignes validées",
  unvalidated: "Lignes non validées",
} as const;

/** Une pastille par filtre actif, dans l'ordre de la barre de filtres. */
export function activeFilterChips(
  filters: MatchingFilters,
  invoices: ReadonlyArray<{ id: string; label: string }>,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const search = filters.search.trim();
  if (search !== "") {
    chips.push({ key: "search", label: `Recherche : « ${search} »`, patch: { search: "" } });
  }
  if (filters.invoiceId !== ALL) {
    const label = invoices.find((invoice) => invoice.id === filters.invoiceId)?.label ?? "inconnue";
    chips.push({ key: "invoiceId", label: `Facture : ${label}`, patch: { invoiceId: ALL } });
  }
  if (filters.supplier !== ALL) {
    chips.push({
      key: "supplier",
      label: `Fournisseur : ${filters.supplier}`,
      patch: { supplier: ALL },
    });
  }
  if (filters.status !== ALL) {
    chips.push({
      key: "status",
      label: `Statut : ${STATUS_LABEL[filters.status]}`,
      patch: { status: ALL },
    });
  }
  if (filters.validation !== "all") {
    chips.push({
      key: "validation",
      label: `Validation : ${VALIDATION_LABEL[filters.validation]}`,
      patch: { validation: "all" },
    });
  }
  return chips;
}

/** « 12 lignes affichées sur 340 » ; singulier pour 0 et 1. */
export function visibleCountText(shown: number, total: number): string {
  return `${shown} ${shown > 1 ? "lignes affichées" : "ligne affichée"} sur ${total}`;
}
