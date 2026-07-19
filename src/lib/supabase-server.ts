import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Server-only Supabase client using the service role key.
 * Bypasses RLS — use only in API routes for admin operations (e.g. reading all users' emails).
 */
export function createServerSupabase() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "[Supabase Server] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。",
    );
  }
  return createClient<Database>(supabaseUrl, serviceRoleKey);
}
