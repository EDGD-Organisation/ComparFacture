import { describe, expect, test } from "bun:test";

import { invoiceCellInfo } from "./invoice-cell";

const date = (value: string | null | undefined) => `le ${value}`;

describe("invoiceCellInfo", () => {
  test("le nom du fichier n'est écrit qu'une fois", () => {
    const info = invoiceCellInfo(
      {
        supplier_name: "Sysco",
        file_name: "facture-sysco-2026-10.pdf",
        invoice_number: "F-12",
        invoice_date: "2026-10-03",
      },
      4,
      date,
    );
    expect(info.title).toBe("facture-sysco-2026-10.pdf");
    expect(info.subtitle).toBe("Sysco · N° F-12 · le 2026-10-03 · ligne 4");
    expect(info.subtitle).not.toContain("facture-sysco-2026-10.pdf");
    expect(info.fullTitle).toBe(
      "facture-sysco-2026-10.pdf · Sysco · N° F-12 · le 2026-10-03 · ligne 4",
    );
  });

  test("sans nom de fichier, le n° de facture sert de titre et n'est pas répété", () => {
    const info = invoiceCellInfo(
      { supplier_name: null, file_name: null, invoice_number: "F-12", invoice_date: null },
      2,
      date,
    );
    expect(info.title).toBe("N° F-12");
    expect(info.subtitle).toBe("ligne 2");
  });

  test("un fournisseur identique au titre n'est pas répété", () => {
    const info = invoiceCellInfo(
      {
        supplier_name: "scan.pdf",
        file_name: "scan.pdf",
        invoice_number: null,
        invoice_date: null,
      },
      1,
      date,
    );
    expect(info.subtitle).toBe("ligne 1");
  });

  test("facture inconnue", () => {
    expect(invoiceCellInfo(null, 7, date)).toEqual({
      title: "Facture",
      subtitle: "ligne 7",
      fullTitle: "Facture · ligne 7",
    });
  });
});
