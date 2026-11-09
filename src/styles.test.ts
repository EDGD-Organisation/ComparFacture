import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("styles.css : tableaux de données", () => {
  test("la case à cocher d'une ligne est centrée par ses marges, pas rognée par la bande de statut", () => {
    // La case est `display: grid` : `text-align: center` ne la centre pas, elle collait au bord
    // gauche de la cellule et la bande de statut de 4 px en cachait un morceau.
    const rule = css.match(
      /\.data-table-scroll \[data-sticky="select"\] > \[role="checkbox"\] \{([^}]*)\}/,
    );
    expect(rule).toBeTruthy();
    expect(rule![1]).toContain("margin-inline: auto");
  });

  test("la colonne des cases fait plus que la bande de statut + la case (4 px + 16 px)", () => {
    const rule = css.match(/\.data-table-scroll \[data-sticky="select"\] \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule![1]).toContain("width: 2.75rem");
  });
});
