import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** Un comparatif (ligne `prospects`). Clé partagée : la page du comparatif et le fil d'Ariane de la facture. */
export const prospectQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["prospect", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("prospects").select("*").eq("id", id).single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
