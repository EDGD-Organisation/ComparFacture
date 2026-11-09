/**
 * Texte d'un segment de fil d'Ariane : tronqué proprement (largeur max, titre complet au survol)
 * et remplacé par « … » pendant le chargement, sans changer la hauteur de la ligne.
 */
export function CrumbText({ text, loading = false }: { text: string | null; loading?: boolean }) {
  if (loading) {
    return (
      <span className="inline-block min-w-4 animate-pulse" role="status" aria-label="Chargement">
        …
      </span>
    );
  }
  return (
    <span title={text ?? undefined} className="block max-w-40 truncate sm:max-w-72">
      {text}
    </span>
  );
}
