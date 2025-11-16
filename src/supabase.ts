import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!, // ⚠️ тільки на бекенді!
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
