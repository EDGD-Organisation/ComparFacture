import { ArrowDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NEXT_TO_REVIEW_TITLE } from "@/lib/use-review-navigation";

export function NextToReviewButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" title={NEXT_TO_REVIEW_TITLE} onClick={onClick}>
      <ArrowDown className="size-4" />
      Prochaine ligne à vérifier
      <kbd className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
        n
      </kbd>
    </Button>
  );
}
