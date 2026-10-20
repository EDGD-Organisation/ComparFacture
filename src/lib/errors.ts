// Turns any error (Error, Supabase/Postgrest error object, raw JSON string from an upstream API)
// into a short French sentence a non-technical user can act on. Pure and dependency-free so it
// can run on both the server (what gets stored in invoices.error_message) and the client.

export const GENERIC_ERROR = "Une erreur est survenue. Veuillez réessayer dans un instant.";

const RULES: Array<{ test: RegExp; message: string }> = [
  {
    test: /\b503\b|unavailable|high demand|overloaded|surcharg/i,
    message:
      "Le service d'analyse est momentanément surchargé. Patientez quelques minutes puis relancez l'analyse.",
  },
  {
    test: /\b429\b|resource_exhausted|rate.?limit|quota|too many requests/i,
    message: "Trop de demandes en même temps. Patientez un instant puis réessayez.",
  },
  {
    test: /gemini_api_key|missing supabase environment|manquante?\b/i,
    message: "La configuration du serveur est incomplète. Contactez un expert.",
  },
  {
    test: /réponse ia vide|invalid_argument|unsupported|could not process|cannot (read|process)/i,
    message:
      "Ce document n'a pas pu être lu. Vérifiez qu'il est net et complet, puis relancez l'analyse.",
  },
  {
    test: /jwt expired|token.*expired|refresh token/i,
    message: "Votre session a expiré. Reconnectez-vous pour continuer.",
  },
  {
    test: /row-level security|permission denied|\b403\b|\b401\b|unauthorized|jwt|not authorized/i,
    message: "Vous n'avez pas les droits nécessaires pour cette action.",
  },
  {
    test: /duplicate key|23505|already exists|already registered/i,
    message: "Cet élément existe déjà.",
  },
  {
    test: /foreign key|23503/i,
    message: "Action impossible : cet élément est encore utilisé ailleurs.",
  },
  {
    test: /pgrst116|not found|\b404\b|no rows/i,
    message: "Élément introuvable. Il a peut-être été supprimé.",
  },
  {
    test: /timeout|timed out|etimedout|econn|enotfound|fetch failed|failed to fetch|networkerror|network request failed/i,
    message: "Connexion impossible. Vérifiez votre réseau puis réessayez.",
  },
  {
    test: /invalid login|invalid credentials/i,
    message: "Email ou mot de passe incorrect.",
  },
  {
    test: /\b5\d\d\b|internal (server )?error|http ?error/i,
    message: "Le service a rencontré un problème. Réessayez dans quelques minutes.",
  },
];

function rawMessage(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) return input.message;
  if (input && typeof input === "object" && "message" in input) {
    const message = (input as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

// Our own server code throws French sentences on purpose ("Accès refusé : …", "Vous ne pouvez
// pas …"). Those are already user-ready and must pass through untouched; anything English,
// JSON-shaped or stack-like is technical.
function isUserReady(message: string): boolean {
  if (!message || message.length > 160 || /[{}[\]]|\bat \S+:\d+|réponse ia/i.test(message))
    return false;
  return /[àâçéèêëîïôûùüÿœ]|^(vous |indiquez |aucun|ce |cette |accès |email |mot de passe )/i.test(
    message.trim(),
  );
}

export function friendlyError(input: unknown, fallback = GENERIC_ERROR): string {
  const raw = rawMessage(input).trim();
  if (!raw) return fallback;
  if (isUserReady(raw)) return raw;
  for (const rule of RULES) {
    if (rule.test.test(raw)) return rule.message;
  }
  // Unknown technical error: keep the detail for developers, show something readable to users.
  console.error("[error]", raw);
  return fallback;
}
