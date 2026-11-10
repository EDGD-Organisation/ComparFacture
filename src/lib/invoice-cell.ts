import { shortDate } from "./format";

export type InvoiceCellSource = {
  supplier_name: string | null;
  file_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
} | null;

export type InvoiceCellInfo = {
  /** Première ligne, tronquée à l'écran : fichier, sinon n° de facture. */
  title: string;
  /** Petit texte dessous : n° de facture, date, ligne. Ni le nom du fichier ni le fournisseur (colonne à part). */
  subtitle: string;
  /** Infobulle : tout, sans troncature. */
  fullTitle: string;
};

/**
 * Contenu de la cellule « Facture » : le nom du fichier n'apparaît qu'une fois (titre), le détail
 * en petit ne le répète pas.
 */
export function invoiceCellInfo(
  invoice: InvoiceCellSource,
  lineNumber: number,
  formatDate: (value: string | null | undefined) => string = shortDate,
): InvoiceCellInfo {
  const title =
    invoice?.file_name ||
    (invoice?.invoice_number ? `N° ${invoice.invoice_number}` : null) ||
    "Facture";
  const supplier = invoice?.supplier_name?.trim();
  const number =
    invoice?.invoice_number && title !== `N° ${invoice.invoice_number}`
      ? `N° ${invoice.invoice_number}`
      : null;
  const date = invoice?.invoice_date ? formatDate(invoice.invoice_date) : null;
  const detail = [number, date, `ligne ${lineNumber}`].filter(Boolean);
  const subtitle = detail.join(" · ");
  // Le fournisseur a sa propre colonne : il n'est rappelé que dans l'infobulle.
  const fullTitle = [title, supplier && supplier !== title ? supplier : null, ...detail]
    .filter(Boolean)
    .join(" · ");
  return { title, subtitle, fullTitle };
}
