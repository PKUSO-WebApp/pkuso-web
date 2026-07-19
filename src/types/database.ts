// ============================================================
// 便捷类型别名 —— 基于 supabase gen-types 生成的 database.types.ts
// database.types.ts 由 pnpm gen-types 生成,不要手动编辑。
// 本文件是纯手写层:下游组件从此导入,不受 gen-types 覆盖影响。
// ============================================================

import type { Database } from "./database.types";

type PublicSchema = Database["public"];

// ---- 表行类型 ----
export type ProfileRow = PublicSchema["Tables"]["profiles"]["Row"];
export type RehearsalRow = PublicSchema["Tables"]["rehearsals"]["Row"];
export type AttendanceRow = PublicSchema["Tables"]["attendances"]["Row"];
export type AnnouncementRow = PublicSchema["Tables"]["announcements"]["Row"];
export type PostRow = PublicSchema["Tables"]["posts"]["Row"];

// ---- 视图 ----
export type UserRow = PublicSchema["Views"]["users"]["Row"];

// ---- 业务类型(DB 有 CHECK 约束但 gen-types 给出 string,此处收紧) ----
export type PostType = "ensemble" | "gathering";
export type AttendanceStatus = "present" | "leave" | "absent";

// ---- Join 扩展(Supabase join 返回的嵌套对象不在生成 schema 中) ----
export type PostRowWithAuthor = PostRow & { users?: { name: string; section: string } | null };
export type AttendanceRowWithUser = AttendanceRow & {
  users?: { name?: string; section?: string } | null;
};
