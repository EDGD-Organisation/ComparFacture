/** Les clés réellement présentes dans un patch (une valeur `undefined` n'est pas une modification). */
function patchKeys<T extends object>(patch: Partial<T>): Array<keyof T> {
  return (Object.keys(patch) as Array<keyof T>).filter((key) => patch[key] !== undefined);
}

/**
 * Mise à jour optimiste : l'objet du cache avec le patch appliqué, sans toucher à l'original.
 * Pas encore de valeur en cache (`undefined`) : rien à patcher.
 */
export function applyPatch<T extends object>(
  current: T | undefined,
  patch: Partial<T>,
): T | undefined {
  if (current === undefined) return undefined;
  const next = { ...current };
  for (const key of patchKeys(patch)) next[key] = patch[key] as T[keyof T];
  return next;
}

/**
 * Retour arrière d'une écriture refusée : remet UNIQUEMENT les champs du patch à leur valeur
 * d'avant. Une autre modification faite entre-temps sur un autre champ est conservée.
 */
export function revertPatch<T extends object>(
  current: T | undefined,
  previous: T | undefined,
  patch: Partial<T>,
): T | undefined {
  if (current === undefined || previous === undefined) return current;
  const next = { ...current };
  for (const key of patchKeys(patch)) next[key] = previous[key];
  return next;
}
