import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export type AppRole = "commercial" | "expert";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const role = (profileQuery.data?.role as AppRole | undefined) ?? null;
  return {
    session,
    email: session?.user.email ?? null,
    role,
    isExpert: role === "expert",
    loading: sessionLoading || (Boolean(userId) && profileQuery.isLoading),
  };
}
