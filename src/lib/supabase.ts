import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  // 在构建或运行时缺少环境变量时给出明确提示，方便排查部署问题
  // 这里不会在浏览器里抛出敏感信息，只在控制台输出
  console.warn(
    "[Supabase] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 环境变量。",
  );
}

export const supabase = createClient<Database>(supabaseUrl ?? "", supabasePublishableKey ?? "");
