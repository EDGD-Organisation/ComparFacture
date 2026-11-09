import { useCallback, useEffect, useRef, useState } from "react";

export const SAVED_INDICATOR_MS = 2000;

/** Indicateur « Enregistré » : `flash()` l'affiche pendant `duration` ms (relancé à chaque appel). */
export function useSavedIndicator(duration = SAVED_INDICATOR_MS) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), duration);
  }, [duration]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }, []);

  return { visible, flash, hide };
}
