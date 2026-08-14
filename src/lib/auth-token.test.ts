import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { getFreshAccessToken } from "./auth-token";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
    },
  },
}));

import { supabase } from "@/lib/supabase";

const getSessionMock = supabase.auth.getSession as Mock;
const refreshSessionMock = supabase.auth.refreshSession as Mock;

/** 当前时间的秒级时间戳（expires_at 单位） */
const nowSec = () => Math.floor(Date.now() / 1000);

describe("getFreshAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("会话存在且未过期 → 返回原 token，不调用 refreshSession", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "tok-1", expires_at: nowSec() + 3600 } },
      error: null,
    });

    const token = await getFreshAccessToken();

    expect(token).toBe("tok-1");
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  it("会话存在但已过期 → 调用 refreshSession 并返回新 token", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "tok-1", expires_at: nowSec() - 10 } },
      error: null,
    });
    refreshSessionMock.mockResolvedValue({
      data: { session: { access_token: "tok-2" } },
      error: null,
    });

    const token = await getFreshAccessToken();

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(token).toBe("tok-2");
  });

  it("会话存在但 60 秒内将过期 → 触发刷新并返回新 token", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "tok-1", expires_at: nowSec() + 30 } },
      error: null,
    });
    refreshSessionMock.mockResolvedValue({
      data: { session: { access_token: "tok-2" } },
      error: null,
    });

    const token = await getFreshAccessToken();

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(token).toBe("tok-2");
  });

  it("无会话且 refreshSession 成功 → 返回新 token", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: { access_token: "tok-new" } },
      error: null,
    });

    const token = await getFreshAccessToken();

    expect(token).toBe("tok-new");
  });

  it("无会话且 refreshSession 失败 → 返回 null", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: "refresh token 已失效" },
    });

    const token = await getFreshAccessToken();

    expect(token).toBeNull();
  });

  it("会话已过期且刷新失败 → 返回 null", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "tok-1", expires_at: nowSec() - 10 } },
      error: null,
    });
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: "refresh token 已失效" },
    });

    const token = await getFreshAccessToken();

    expect(token).toBeNull();
  });
});
