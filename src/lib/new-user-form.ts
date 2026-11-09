/** Règles du serveur (`CreateUserInput` dans users.functions.ts) : e-mail valide, mot de passe de 8 caractères minimum. */
export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export type NewUserCheck = {
  valid: boolean;
  /** Message sous le champ, `null` quand le champ est correct. Un champ vide n'est pas une « faute » avant interaction : voir `visibleError`. */
  emailError: string | null;
  passwordError: string | null;
  /** Ce qui manque, dans les mots de l'aide sous le formulaire. */
  missing: string[];
};

export function checkNewUser(input: { email: string; password: string }): NewUserCheck {
  const email = input.email.trim();
  const emailError =
    email === ""
      ? "Indiquez une adresse e-mail."
      : isValidEmail(email)
        ? null
        : "Cette adresse e-mail n'est pas valide (exemple : nom@societe.fr).";
  const passwordError =
    input.password.length >= MIN_PASSWORD_LENGTH
      ? null
      : `Le mot de passe doit faire ${MIN_PASSWORD_LENGTH} caractères minimum (${input.password.length} saisi${input.password.length > 1 ? "s" : ""}).`;
  const missing = [
    emailError ? "un e-mail valide" : null,
    passwordError ? `un mot de passe de ${MIN_PASSWORD_LENGTH} caractères minimum` : null,
  ].filter((item): item is string => item !== null);
  return { valid: missing.length === 0, emailError, passwordError, missing };
}

/** Phrase d'aide sous le formulaire, ou `null` quand le compte peut être créé. */
export function missingHelp(check: NewUserCheck): string | null {
  if (check.valid) return null;
  return `Pour créer le compte, il manque : ${check.missing.join(" et ")}.`;
}

/** Un message n'apparaît qu'une fois le champ touché (sorti, ou formulaire soumis) : pas d'erreur dès le premier caractère. */
export function visibleError(error: string | null, touched: boolean): string | null {
  return touched ? error : null;
}
