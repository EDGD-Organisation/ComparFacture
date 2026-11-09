import "@tanstack/history";

declare module "@tanstack/history" {
  /** Clés d'état de navigation posées par nos liens (voir FROM_VUE_STATE_KEY dans search-params). */
  interface HistoryState {
    fromVue?: "rapprochements";
  }
}
