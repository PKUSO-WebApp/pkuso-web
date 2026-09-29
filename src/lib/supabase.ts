import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const MISSING_ENV_MESSAGE =
  "[Supabase] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 环境变量。\n" +
  "本地请确认 .env.local 存在（见 .env.example）。";

/**
 * 缺 env 时的替身：**构造不抛，取用才抛**。
 *
 * ## 为什么必须有它
 *
 * 本模块在**模块作用域**建客户端，而 Next 的 App Router 会把客户端组件也预渲染一遍
 * （生成首屏 HTML 时要在服务端走一遍模块图）。于是**构建机上没有 env 时，
 * 仅仅 import 这个模块就会抛**，整个构建挂掉。
 *
 * 实测（2026-09-29，把 .env.local 移开跑 `pnpm build`）：
 *
 *     Error occurred prerendering page "/reset-password/reset"  → supabaseUrl is required.
 *     Error occurred prerendering page "/admin/rehearsals"      → 同样在炸
 *
 * 受害页面不止一个 —— 构建只是报它先撞上的那个。而 `src/app` 下有 20+ 个文件
 * 在模块作用域 import 本模块。
 *
 * ## 为什么不是「延迟构造真客户端」
 *
 * 试过那个方案，但它对**真的在渲染路径上用了 supabase** 的页面毫无帮助（照样抛），
 * 却要在生产环境给每一次属性访问都套一层 Proxy。替身只影响「缺 env」这一条路，
 * **正常路径（有 env）拿到的仍是原样的真客户端，零间接层**。
 *
 * ## 它带来的实际改变
 *
 * - 构建期不碰 supabase 的页面 → **照常预渲染，构建不再需要 env**
 * - 真的在渲染路径上用了它 → 得到上面那句能读懂的话，而不是 SDK 内部的
 *   `supabaseUrl is required.`
 *
 * ⚠️ 别把它换回 `createClient(url ?? "", key ?? "")`：`?? ""` 把「缺 env」变成了
 * 「空字符串」，而 SDK 对空串就是抛 —— 那正是这个 bug 的成因。
 */
function missingEnvStub(): SupabaseClient<Database> {
  return new Proxy({} as SupabaseClient<Database>, {
    get() {
      throw new Error(MISSING_ENV_MESSAGE);
    },
  });
}

export const supabase: SupabaseClient<Database> =
  supabaseUrl && supabasePublishableKey
    ? createClient<Database>(supabaseUrl, supabasePublishableKey)
    : missingEnvStub();

/** 供测试与诊断用：当前是否有可用的客户端（没有时 `supabase` 是抛错替身） */
export const hasSupabaseEnv = Boolean(supabaseUrl && supabasePublishableKey);
