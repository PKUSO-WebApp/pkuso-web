"use client";

import React from "react";

/**
 * 「用 `member_info` 同步所有已通过用户的 profile」。
 *
 * ## 为什么要提出来
 *
 * 这段逻辑在 `admin/config/import` 与 `admin/members` 两个页面里**各抄了一份、
 * 逐字符相同**（40 行 ×2）。它把四个易错点绑在一起，抄第二份时就是「下次改一处漏一处」
 * 的典型形状：
 *
 * 1. **必须先确认** —— 这个动作会**覆盖现有数据**（邮箱为空时不动已有邮箱，所以措辞要准确）
 * 2. **token 从 session 拿，没有就抛「未登录」** —— 不能拿空 `Bearer` 去请求
 *    （服务端会 401，而报错文案会变成「同步失败」，查起来离真正的原因很远）
 * 3. **服务端非 2xx 时用服务端给的 `error` 文案** —— 别自己编一句覆盖掉
 * 4. **成功后整页 `reload()`** —— 同步会改很多行，局部刷新不可靠
 *
 * 附带的好处：两个页面各自少 40 行（它们都在 500 行上下，见设计债棘轮）。
 */

/** 确认文案。⚠️ 后半句（邮箱为空时不覆盖）是**承诺**，改语义时两处一起改 */
const CONFIRM_TEXT =
  "确认要使用 member_info 数据同步所有已通过用户的 profile 吗？\n\n此操作会覆盖现有数据，但邮箱为空时不会覆盖已有邮箱。";

export function useProfileSync(): {
  /** 同步进行中（按钮据此 disable + 转圈 + 换文案） */
  syncing: boolean;
  /** 执行同步：内部处理确认、鉴权、错误文案与刷新 */
  syncProfiles: () => Promise<void>;
} {
  const [syncing, setSyncing] = React.useState(false);

  const syncProfiles = React.useCallback(async () => {
    if (!confirm(CONFIRM_TEXT)) return;

    setSyncing(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("未登录");
      }

      const response = await fetch("/api/admin/sync-profiles", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "同步失败");
      }

      alert(result.message || "同步完成");
      window.location.reload();
    } catch (err) {
      alert(`同步失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  }, []);

  return { syncing, syncProfiles };
}
