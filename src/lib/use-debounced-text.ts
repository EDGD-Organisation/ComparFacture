import { useEffect, useMemo, useRef, useState } from "react";

import { createDebouncer } from "./debounce";

export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Champ de recherche relié à l'URL : l'état local suit la frappe sans délai, l'URL (`urlValue`)
 * n'est mise à jour qu'après `delay` ms sans frappe. Une valeur d'URL qui ne vient pas de nous
 * (bouton Précédent, lien, réinitialisation des filtres) remplace le texte saisi.
 */
export function useDebouncedText(
  urlValue: string,
  commit: (value: string) => void,
  delay = SEARCH_DEBOUNCE_MS,
) {
  const [text, setText] = useState(urlValue);
  const known = useRef(urlValue);
  const commitRef = useRef(commit);

  useEffect(() => {
    commitRef.current = commit;
  });

  const debouncer = useMemo(
    () =>
      createDebouncer((value: string) => {
        if (value === known.current) return;
        known.current = value;
        commitRef.current(value);
      }, delay),
    [delay],
  );

  useEffect(() => () => debouncer.cancel(), [debouncer]);

  useEffect(() => {
    if (urlValue === known.current) return;
    known.current = urlValue;
    debouncer.cancel();
    setText(urlValue);
  }, [urlValue, debouncer]);

  const onChange = (value: string) => {
    setText(value);
    debouncer.call(value);
  };

  return [text, onChange] as const;
}
