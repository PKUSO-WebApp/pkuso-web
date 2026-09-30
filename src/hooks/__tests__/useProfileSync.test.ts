// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useProfileSync } from "../useProfileSync";

/**
 * 这段逻辑原本在两个页面里**各抄一份、逐字符相同**（各 40 行）。
 * 用例钉的是那四个易错点，不是实现：
 *
 * 1. 用户不确认 ⇒ **一个请求都不发**（覆盖数据是不可逆的）
 * 2. 没有 session ⇒ 文案说「未登录」且**不发请求**（拿空 Bearer 去请求会变成
 *    「同步失败」，把真正的原因埋掉）
 * 3. 服务端非 2xx ⇒ 用**服务端给的 error 文案**，不要自己编一句覆盖
 * 4. 成功 ⇒ 用服务端的 message（缺省「同步完成」）+ 整页 reload
 */

const h = vi.hoisted(() => ({
  session: { access_token: "tok" } as { access_token: string } | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: h.session } }) },
  },
}));

let reloadSpy: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { access_token: "tok" };
  reloadSpy = vi.fn();
  // jsdom 下 window.location.reload 不可单独 redefine（non-configurable），
  // 整体替换 window.location 对象（同 layout.test.tsx 的写法）
  Object.defineProperty(window, "location", {
    value: { reload: reloadSpy },
    configurable: true,
    writable: true,
  });
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useProfileSync", () => {
  it("用户点了「取消」⇒ 一个请求都不发", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const { result } = renderHook(() => useProfileSync());

    await act(async () => {
      await result.current.syncProfiles();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(result.current.syncing).toBe(false);
  });

  it("没有 session ⇒ 说「未登录」，且不发请求", async () => {
    h.session = null;
    const { result } = renderHook(() => useProfileSync());

    await act(async () => {
      await result.current.syncProfiles();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("未登录"));
  });

  it("服务端非 2xx ⇒ 文案用**服务端给的** error（不是自己编的）", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "member_info 里没有可同步的行" }),
    });
    const { result } = renderHook(() => useProfileSync());

    await act(async () => {
      await result.current.syncProfiles();
    });

    expect(alert).toHaveBeenCalledWith(expect.stringContaining("member_info 里没有可同步的行"));
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("成功 ⇒ 用服务端的 message，并整页 reload", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ message: "已同步 12 名成员" }),
    });
    const { result } = renderHook(() => useProfileSync());

    await act(async () => {
      await result.current.syncProfiles();
    });

    expect(alert).toHaveBeenCalledWith("已同步 12 名成员");
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("成功但服务端没给 message ⇒ 退回「同步完成」", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useProfileSync());

    await act(async () => {
      await result.current.syncProfiles();
    });

    expect(alert).toHaveBeenCalledWith("同步完成");
  });

  it("token 放进 Authorization 头（不是 query、也不是 body）", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useProfileSync());

    await act(async () => {
      await result.current.syncProfiles();
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/admin/sync-profiles");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("请求抛异常时 syncing 要复位（否则按钮永远转圈）", async () => {
    fetchSpy.mockRejectedValue(new Error("网络断了"));
    const { result } = renderHook(() => useProfileSync());

    await act(async () => {
      await result.current.syncProfiles();
    });

    expect(result.current.syncing).toBe(false);
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("网络断了"));
  });
});
