import { Link } from "@tanstack/react-router";

import { invoiceCellInfo } from "@/lib/invoice-cell";
import type { MatchingLine } from "@/lib/matching-view";
import { FROM_VUE_STATE_KEY } from "@/lib/search-params";

/**
 * Cellule « Facture » de la vue projet : une ligne tronquée (lien vers la facture, nom complet en
 * infobulle) et un petit texte dessous qui ne répète pas le nom du fichier.
 */
export function InvoiceCell({
  line,
}: {
  line: Pick<MatchingLine, "invoice_id" | "invoices" | "line_number">;
}) {
  const { title, subtitle, fullTitle } = invoiceCellInfo(line.invoices, line.line_number);
  return (
    <div className="w-40" title={fullTitle}>
      <Link
        to="/factures/$id"
        params={{ id: line.invoice_id }}
        state={{ [FROM_VUE_STATE_KEY]: "rapprochements" }}
        className="block truncate font-medium hover:text-primary"
      >
        {title}
      </Link>
      <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
    </div>
  );
}
