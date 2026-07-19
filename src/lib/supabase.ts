import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function createSupabase() {
  if (!supabaseUrl || !supabasePublishableKey) {
    console.warn(
      "[Supabase] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 环境变量。",
    );
    // 测试环境返回 stub,避免 createClient("","") crash
    if (process.env.VITEST) return undefined!;
  }
  return createClient(supabaseUrl ?? "", supabasePublishableKey ?? "");
}

export const supabase = createSupabase();
