import type { ReactNode } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";

/** Confirmation d'une suppression définitive : `ConfirmDialog` avec un bouton « Supprimer » rouge. */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      confirmLabel="Supprimer"
      destructive
      onConfirm={onConfirm}
    >
      {children}
    </ConfirmDialog>
  );
}
