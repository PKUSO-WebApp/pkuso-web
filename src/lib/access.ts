/**
 * 角色 × 路径的访问判据（**单一事实来源**）。
 *
 * 「谁能登进 web 端」「登录后落在哪」「能停在 /admin/** 的哪些路径上」只在这里定义。
 * 三个调用点都从这里取答案，**不要再内联 `role !== "admin"`**：
 *   - `app/(auth)/login/page.tsx` —— 登录闸门（放行还是 signOut）
 *   - `components/auth-gate.tsx`   —— 已登录用户在路由之间被弹去哪
 *   - `app/admin/layout.tsx`       —— 渲染守卫（渲染 children 还是守护页）
 * 加一个角色时漏改其中任意一处就是权限洞，所以判据必须收在一处。
 *
 * 未知角色 / 尚未加载（null）一律**失败关闭**：不放行、不落点。
 */
import type { UserRole } from "@/context/user-context";

/** score_manager 唯一被允许的路径前缀（谱务） */
const SHEET_MUSIC_ROOT = "/admin/sheet-music";

/**
 * 登录后（或被弹回时）的落点；返回 `null` = 该角色不允许进入 web 端。
 * - `admin` → 首页宫格 `/admin`
 * - `score_manager` → 谱务列表（他只碰谱务，别处对他都是死胡同）
 */
export function landingPathFor(role: UserRole | null | undefined): string | null {
  if (role === "admin") return "/admin";
  if (role === "score_manager") return SHEET_MUSIC_ROOT;
  return null;
}

/**
 * 该角色能否停在 `/admin/**` 的这个路径上。
 * - `admin` → 全部路径
 * - `score_manager` → 只有谱务（`/admin/sheet-music` 及其子路径，如曲子详情）
 * - `member` / 未知 / `null` → 任何 `/admin/**` 都不行
 *
 * ⚠️ `null`（角色还没加载出来）返回 false。角色与「已批准」是同一批 setState 落地的，
 * 调用方必须先确认 `profileStatus === "approved"` 之类的就绪信号再判，
 * 否则会在资料到位前把人弹走。
 */
export function canVisitAdminPath(pathname: string, role: UserRole | null | undefined): boolean {
  if (role === "admin") return true;
  if (role !== "score_manager") return false;
  // 前缀必须带 `/`：`/admin/sheet-music-x` 不是谱务，裸 startsWith 会把它放进来
  return pathname === SHEET_MUSIC_ROOT || pathname.startsWith(`${SHEET_MUSIC_ROOT}/`);
}
