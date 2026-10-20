import { toast } from "sonner";

import { friendlyError } from "./errors";

// Shows an error as a toast (top-right, see <Toaster /> in __root.tsx) in plain French.
// `fallback` replaces the generic sentence when the error isn't one we recognise.
export function toastError(error: unknown, fallback?: string) {
  toast.error(friendlyError(error, fallback), { duration: 6000 });
}
