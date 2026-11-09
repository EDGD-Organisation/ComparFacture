import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

export function SupplierMultiSelect({
  id,
  value,
  onChange,
  placeholder = "Aucun fournisseur choisi",
  description,
  disabled,
  className,
}: Props) {
  const suppliersQuery = useQuery({
    queryKey: ["catalog-suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("distinct_catalog_suppliers");
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((row) => row.supplier_name)
        .filter((name): name is string => Boolean(name));
    },
  });

  function toggle(name: string) {
    onChange(value.includes(name) ? value.filter((s) => s !== name) : [...value, name]);
  }

  return (
    <div className="grid gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            disabled={disabled}
            aria-describedby={description ? `${id}-description` : undefined}
            className={cn("w-full justify-between font-normal", className)}
          >
            <span
              className={cn("truncate text-left", value.length === 0 && "text-muted-foreground")}
            >
              {value.length > 0
                ? `${value.length} fournisseur${value.length > 1 ? "s" : ""}`
                : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <Command>
            <CommandInput placeholder="Rechercher un fournisseur…" />
            <CommandList>
              <CommandEmpty>Aucun fournisseur trouvé.</CommandEmpty>
              <CommandGroup>
                {(suppliersQuery.data ?? []).map((name) => (
                  <CommandItem key={name} onSelect={() => toggle(name)}>
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        value.includes(name) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {description ? (
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((name) => (
            <Badge key={name} variant="secondary" className="max-w-full gap-1 pr-1 font-normal">
              <span className="truncate" title={name}>
                {name}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(name)}
                aria-label={`Retirer ${name}`}
                className="shrink-0 rounded-full p-1 hover:bg-muted-foreground/20 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
