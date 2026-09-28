import { describe, it, expect } from "vitest";
import { landingPathFor, canVisitAdminPath } from "./access";
import type { UserRole } from "@/context/user-context";

/**
 * 不该放行的角色。`""` 与 `"superadmin"` 不在 `UserRole` 里——脏数据 / 枚举漂移时
 * 判据也必须失败关闭，所以这里**故意越出类型**把它们传进来（故需断言）。
 */
const BLOCKED_ROLES = ["member", "", "superadmin", null, undefined] as (
  UserRole | null | undefined
)[];

/** 除谱务外的 admin 路径（score_manager 一处都不该进得去） */
const NON_SHEET_MUSIC_ADMIN_PATHS = [
  "/admin",
  "/admin/",
  "/admin/roster",
  "/admin/members",
  "/admin/attendance",
  "/admin/rehearsals",
  "/admin/rehearsals/new",
  "/admin/profile",
  "/admin/config/import",
];

describe("landingPathFor", () => {
  it("admin 落到首页宫格", () => {
    expect(landingPathFor("admin")).toBe("/admin");
  });

  it("score_manager 落到谱务列表（不是成员引导页 /）", () => {
    expect(landingPathFor("score_manager")).toBe("/admin/sheet-music");
  });

  it("member / 未知角色 / 未加载 都不放行", () => {
    for (const role of BLOCKED_ROLES) {
      expect(landingPathFor(role)).toBeNull();
    }
  });
});

describe("canVisitAdminPath", () => {
  it("admin 可以停在任何 /admin 路径（含谱务）", () => {
    const paths = [...NON_SHEET_MUSIC_ADMIN_PATHS, "/admin/sheet-music", "/admin/sheet-music/42"];
    for (const pathname of paths) {
      expect(canVisitAdminPath(pathname, "admin")).toBe(true);
    }
  });

  it("score_manager 只能停在谱务列表与曲子详情", () => {
    expect(canVisitAdminPath("/admin/sheet-music", "score_manager")).toBe(true);
    expect(canVisitAdminPath("/admin/sheet-music/", "score_manager")).toBe(true);
    expect(canVisitAdminPath("/admin/sheet-music/8f3a-1b", "score_manager")).toBe(true);
    expect(canVisitAdminPath("/admin/sheet-music/8f3a-1b/edit", "score_manager")).toBe(true);
  });

  it("score_manager 进不去任何非谱务的 /admin 路径", () => {
    for (const pathname of NON_SHEET_MUSIC_ADMIN_PATHS) {
      expect(canVisitAdminPath(pathname, "score_manager")).toBe(false);
    }
  });

  it("同前缀的旁路路径不算谱务", () => {
    expect(canVisitAdminPath("/admin/sheet-music-evil", "score_manager")).toBe(false);
    expect(canVisitAdminPath("/admin/sheet-music2", "score_manager")).toBe(false);
    // Next 路由区分大小写，大写开头不是同一条路由
    expect(canVisitAdminPath("/Admin/sheet-music", "score_manager")).toBe(false);
  });

  it("member / 未知角色 / 未加载 一处 /admin 路径都进不去", () => {
    const paths = [...NON_SHEET_MUSIC_ADMIN_PATHS, "/admin/sheet-music", "/admin/sheet-music/42"];
    for (const role of BLOCKED_ROLES) {
      for (const pathname of paths) {
        expect(canVisitAdminPath(pathname, role)).toBe(false);
      }
    }
  });

  it("判据对每个角色都返回布尔值（不会把 null 当 truthy 漏放）", () => {
    const roles: (UserRole | null | undefined)[] = ["admin", "score_manager", "member", null];
    for (const role of roles) {
      expect(typeof canVisitAdminPath("/admin/sheet-music", role)).toBe("boolean");
    }
  });
});
