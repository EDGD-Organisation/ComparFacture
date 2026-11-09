export type Debouncer<T> = {
  /** Programme `fn(value)` après `delay` ms de calme ; un nouvel appel annule le précédent. */
  call(value: T): void;
  cancel(): void;
  pending(): boolean;
};

export function createDebouncer<T>(fn: (value: T) => void, delay: number): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call(value) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(value);
      }, delay);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    pending: () => timer !== null,
  };
}
