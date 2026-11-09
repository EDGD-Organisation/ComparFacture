import { describe, expect, test } from "bun:test";

import { checkNewUser, isValidEmail, missingHelp, visibleError } from "./new-user-form";

describe("checkNewUser", () => {
  test("e-mail valide et mot de passe de 8 caractères : valide, rien ne manque", () => {
    const check = checkNewUser({ email: "a@b.fr", password: "12345678" });
    expect(check).toEqual({ valid: true, emailError: null, passwordError: null, missing: [] });
    expect(missingHelp(check)).toBeNull();
  });

  test("formulaire vide : les deux éléments manquent", () => {
    const check = checkNewUser({ email: "", password: "" });
    expect(check.valid).toBe(false);
    expect(check.missing).toEqual(["un e-mail valide", "un mot de passe de 8 caractères minimum"]);
    expect(missingHelp(check)).toBe(
      "Pour créer le compte, il manque : un e-mail valide et un mot de passe de 8 caractères minimum.",
    );
  });

  test("7 caractères : trop court, le message compte les caractères saisis", () => {
    const check = checkNewUser({ email: "a@b.fr", password: "1234567" });
    expect(check.valid).toBe(false);
    expect(check.passwordError).toContain("8 caractères minimum");
    expect(check.passwordError).toContain("7 saisis");
    expect(check.missing).toEqual(["un mot de passe de 8 caractères minimum"]);
    expect(checkNewUser({ email: "a@b.fr", password: "1" }).passwordError).toContain("1 saisi)");
  });

  test("e-mail mal formé : message différent d'un e-mail vide", () => {
    const empty = checkNewUser({ email: "  ", password: "12345678" });
    const malformed = checkNewUser({ email: "pas-un-mail", password: "12345678" });
    expect(empty.emailError).toBe("Indiquez une adresse e-mail.");
    expect(malformed.emailError).toContain("n'est pas valide");
    expect(malformed.missing).toEqual(["un e-mail valide"]);
  });

  test("isValidEmail", () => {
    expect(isValidEmail(" nom@societe.fr ")).toBe(true);
    expect(isValidEmail("nom@societe")).toBe(false);
    expect(isValidEmail("nom societe@x.fr")).toBe(false);
    expect(isValidEmail("@x.fr")).toBe(false);
  });
});

describe("visibleError", () => {
  test("le message n'apparaît qu'après interaction", () => {
    expect(visibleError("Erreur", false)).toBeNull();
    expect(visibleError("Erreur", true)).toBe("Erreur");
    expect(visibleError(null, true)).toBeNull();
  });
});
