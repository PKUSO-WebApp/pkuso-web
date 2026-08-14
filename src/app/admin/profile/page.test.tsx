// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProfilePage from "./page";
import { supabase } from "@/lib/supabase";
import type { InvitationCodeRow } from "@/types/database";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    }),
    auth: {
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-admin-id" } }, error: null }),
      // 邮件签名读取/保存通过 getSession 拿 token（fetchSignature / handleSaveSignature 使用）
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: "test-token" } }, error: null }),
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/context/user-context", () => ({
  useUser: () => ({
    user: { id: "test-admin-id", name: "管理员", email: "admin@example.com", section: "指挥" },
    logout: vi.fn(),
  }),
}));

/** 构造 supabase.from() 返回正确的 select/order 链式 mock */
function setupSupabaseMock(options: {
  fetchData?: unknown;
  fetchError?: unknown;
  insertFn?: Mock; // 插入函数 mock（传入 mock 时，insert 调用参数会透传给它）
  insertData?: unknown; // 插入调用后的返回值（resolve 值或带 select/single 的链）
  deleteFn?: Mock; // 删除函数 mock（传入 mock 时，delete 调用参数会透传给它）
  deleteData?: unknown; // 删除链的 resolve 值
}) {
  const { fetchData, fetchError, insertFn, insertData, deleteFn, deleteData } = options;

  const orderMock = vi
    .fn()
    .mockResolvedValue(
      fetchError ? { data: null, error: fetchError } : { data: fetchData ?? [], error: null },
    );
  const selectMock = vi.fn().mockReturnValue({ order: orderMock });

  const baseChain: Record<string, unknown> = {
    select: selectMock,
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
  };

  if (insertFn && insertData !== undefined) {
    // 最常见：insert 本身是 mock（记录调用参数），其返回值是带 select/single 的链
    baseChain.insert = vi.fn((...args: unknown[]) => {
      insertFn(...args);
      return insertData;
    });
  } else if (insertData !== undefined) {
    if (typeof insertData === "function") {
      baseChain.insert = insertData;
    } else {
      baseChain.insert = vi.fn().mockReturnValue(insertData);
    }
  }

  if (deleteFn && deleteData !== undefined) {
    // 删除链：deleteFn 作为 baseChain.delete，通过 mockImplementation 记录参数
    // vi.fn() 会自动记录调用参数到 mock.calls，不需要手动捕获
    const eqMock = vi.fn().mockReturnValue(deleteData);
    deleteFn.mockImplementation(() => {
      return { eq: eqMock };
    });
    baseChain.delete = deleteFn;
  } else if (deleteData !== undefined) {
    if (typeof deleteData === "function") {
      baseChain.delete = deleteData;
    } else {
      baseChain.delete = vi.fn().mockReturnValue(deleteData);
    }
  }

  (supabase.from as Mock).mockReturnValue(baseChain);

  return { orderMock, selectMock, baseChain };
}

const sampleCode = (overrides: Partial<InvitationCodeRow> = {}): InvitationCodeRow => ({
  id: "code-1",
  code: "ABCDEFGH",
  max_uses: 1,
  used_count: 0,
  created_by: "test-admin-id",
  created_at: "2024-07-31T14:30:00Z",
  expires_at: null,
  used_by: null,
  ...overrides,
});

describe("邀请码管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---- 原有生成测试 ----

  it("显示邀请码管理区域", () => {
    render(<ProfilePage />);
    expect(screen.getByRole("button", { name: /管理邀请码/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生成邀请码/ })).toBeInTheDocument();
  });

  it("打开生成邀请码 Modal 并显示单个/批量切换", async () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText("生成方式")).toBeInTheDocument();
      expect(screen.getByText("单个生成")).toBeInTheDocument();
      expect(screen.getByText("批量生成")).toBeInTheDocument();
    });
  });

  it("单个生成邀请码 - 自动生成 8 位随机码并写入 invitation_codes", async () => {
    const singleResult = {
      id: "code-1",
      code: "ABCDEFGH",
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    };
    const singleMock = vi.fn().mockResolvedValue({ data: singleResult, error: null });
    // insertMock 返回带 select/single 的链，同时记录调用参数
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: singleMock,
    });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByRole("button", { name: /^生成$/ });
    });

    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith("invitation_codes");
      expect(insertMock).toHaveBeenCalled();
      const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.code).toHaveLength(8);
      expect(inserted.created_by).toBe("test-admin-id");
      expect(singleMock).toHaveBeenCalled();
    });
  });

  it("单个生成邀请码 - 生成结果显示在 Modal 内并提供复制按钮", async () => {
    const singleResult = {
      id: "code-2",
      code: "MYCODE01",
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    };
    const singleMock = vi.fn().mockResolvedValue({ data: singleResult, error: null });
    setupSupabaseMock({
      fetchData: [],
      insertData: { select: vi.fn().mockReturnThis(), single: singleMock },
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByRole("button", { name: /^生成$/ });
    });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(screen.getByText("MYCODE01")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    });
  });

  it("批量生成邀请码 - 默认数量为 5 个", async () => {
    const batchCodes = Array.from({ length: 5 }, (_, i) => ({
      id: `batch-${i}`,
      code: `CODE${i.toString().padStart(4, "0")}`,
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    }));
    const selectMock = vi.fn().mockResolvedValue({ data: batchCodes, error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("批量生成"));
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const batch = insertMock.mock.calls[0][0] as Record<string, unknown>[];
      expect(batch).toHaveLength(5);
      batch.forEach((item) => {
        expect(item.code as string).toHaveLength(8);
        expect(item.created_by).toBe("test-admin-id");
      });
      expect(selectMock).toHaveBeenCalled();
    });
  });

  it("批量生成邀请码 - 指定数量", async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const batch = insertMock.mock.calls[0][0] as Record<string, unknown>[];
      expect(batch).toHaveLength(3);
    });
  });

  it("批量生成邀请码 - 数量小于 1 时显示错误提示", async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // 应该显示错误提示，而不是调用 insert
      const errEl = screen.getByText("生成数量必须为 1-100");
      expect(errEl.closest("p")).toHaveClass("text-danger");
      expect(insertMock).not.toHaveBeenCalled();
    });
  });

  it("批量生成邀请码 - 数量大于 100 时显示错误提示", async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // 应该显示错误提示，而不是调用 insert
      const errEl = screen.getByText("生成数量必须为 1-100");
      expect(errEl.closest("p")).toHaveClass("text-danger");
      expect(insertMock).not.toHaveBeenCalled();
    });
  });

  it("生成失败时 Modal 内显示错误提示（text-danger）", async () => {
    const singleMock = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } });
    setupSupabaseMock({
      fetchData: [],
      insertData: { select: vi.fn().mockReturnThis(), single: singleMock },
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByRole("button", { name: /^生成$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // createSingle 失败时直接返回 dbError.message，handleGenerate 据此设置 genError，
      // 因此 Modal 内显示的是具体的 DB 错误信息（"DB error"）而非通用兜底文案
      const errEl = screen.getByText("DB error");
      expect(errEl.closest("p")).toHaveClass("text-danger");
    });
  });

  // ---- Issue #94 回归：23505 unique_violation 显式文案 ----
  it("createSingle 返回 23505 错误时，Modal 内显示'邀请码已存在，请更换'", async () => {
    // 模拟 PostgreSQL 23505 duplicate key 错误（customCode 与已有邀请码冲突）
    // hook 的 createSingle 检测到 dbError.code === "23505" 后返回专门文案，
    // handleGenerate 直接消费 result.error 设置 genError，UI 显示专门文案
    const singleMock = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });
    setupSupabaseMock({
      fetchData: [],
      insertData: { select: vi.fn().mockReturnThis(), single: singleMock },
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByRole("button", { name: /^生成$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // 关键断言：UI 显示专门文案，而非 dbError.message 或通用兜底
      const errEl = screen.getByText("邀请码已存在，请更换");
      expect(errEl.closest("p")).toHaveClass("text-danger");
    });
  });

  it("连续两次 23505 错误，UI 两次都显示'邀请码已存在，请更换'（不退化为通用文案）", async () => {
    // 这是首轮 adversary 击破的核心场景：
    // React 18 automatic batching 下，连续两次相同 23505 冲突会让 setError(null)→setError(msg)
    // 被 batch 成最终与上一次相同的值，Object.is 判等触发 React bailout，useEffect 不会重新执行，
    // 调用方拿不到最新错误，UI 第二次显示通用兜底文案而非 23505 专门文案。
    // 修复后 createSingle 直接返回 { data, error }，handleGenerate 同步设置 genError，
    // 不再依赖 useEffect 同步 hook 的 error 状态，故第二次仍显示专门文案。
    const singleMock = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });
    setupSupabaseMock({
      fetchData: [],
      insertData: { select: vi.fn().mockReturnThis(), single: singleMock },
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    // 第一次生成
    await waitFor(() => screen.getByRole("button", { name: /^生成$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(screen.getByText("邀请码已存在，请更换")).toBeInTheDocument();
    });

    // 等待按钮重新可点击（isGenSubmitting 在 finally 中重置）
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^生成$/ })).not.toBeDisabled();
    });

    // 第二次生成（关键：不再变通用文案，仍是"邀请码已存在，请更换"）
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // 关键断言：第二次仍显示专门文案，而非"邀请码生成失败，请重试"
      expect(screen.getByText("邀请码已存在，请更换")).toBeInTheDocument();
      // 不应出现通用兜底文案（adversary 击破时的退化现象）
      expect(screen.queryByText("邀请码生成失败，请重试")).not.toBeInTheDocument();
    });

    // 两次 createSingle 调用都触发了 single mock
    expect(singleMock).toHaveBeenCalledTimes(2);
  });

  it("批量生成结果列表显示所有 code 并带复制按钮", async () => {
    const codes = Array.from({ length: 3 }, (_, i) => ({
      id: `b-${i}`,
      code: `BATCH${i}`,
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    }));
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: codes, error: null }),
    });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      codes.forEach((c) => {
        expect(screen.getByText(c.code)).toBeInTheDocument();
      });
      expect(screen.getByText(/生成结果.*3.*个/)).toBeInTheDocument();
    });
  });

  it("生成失败时批量也显示错误提示", async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: { message: "Batch insert failed" } }),
    });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(screen.getByText("邀请码生成失败，请重试")).toBeInTheDocument();
    });
  });

  it("单个生成邀请码 - 随机码排除易混淆字符（0/O/1/I）", async () => {
    const insertMock = vi.fn();
    const singleMock = vi.fn().mockImplementation(async (codeArg: Record<string, unknown>) => {
      return {
        data: { ...codeArg, id: "x", created_at: new Date().toISOString() },
        error: null,
      };
    });
    setupSupabaseMock({
      fetchData: [],
      insertFn: insertMock,
      insertData: { select: vi.fn().mockReturnThis(), single: singleMock },
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByRole("button", { name: /^生成$/ }));

    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));
      await waitFor(() => {
        expect(insertMock).toHaveBeenCalled();
      });
      const inserted = insertMock.mock.calls[insertMock.mock.calls.length - 1][0] as Record<
        string,
        unknown
      >;
      const code = inserted.code as string;
      expect(code).not.toMatch(/[0O1I]/);
      expect(code).toHaveLength(8);
    }
  });

  // ---- 管理邀请码视图测试 ----

  it("管理视图：显示邀请码列表和状态（可用）", async () => {
    const codes: InvitationCodeRow[] = [sampleCode()];
    setupSupabaseMock({ fetchData: codes });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText("ABCDEFGH")).toBeInTheDocument();
      expect(screen.getByText("可用")).toBeInTheDocument();
      expect(screen.getByText(/使用.*0\/1/)).toBeInTheDocument();
      // formatDateTimeInChina: UTC 14:30 → 北京时间 22:30
      expect(screen.getByText(/07\/31 22:30/)).toBeInTheDocument();
    });
  });

  it("管理视图：邀请码用完时显示'已用完'", async () => {
    const codes: InvitationCodeRow[] = [
      sampleCode({ id: "code-ex", code: "EXHAUST01", max_uses: 3, used_count: 3 }),
    ];
    setupSupabaseMock({ fetchData: codes });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText("EXHAUST01")).toBeInTheDocument();
      expect(screen.getByText("已用完")).toBeInTheDocument();
    });
  });

  it("管理视图：used_count >= max_uses 时显示'已用完'", async () => {
    const codes: InvitationCodeRow[] = [
      sampleCode({
        id: "code-used",
        code: "USEDCODE01",
        max_uses: 1,
        used_count: 1,
        used_by: ["user-1"],
      }),
    ];
    setupSupabaseMock({ fetchData: codes });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText("已用完")).toBeInTheDocument();
    });
  });

  it("管理视图：无限次邀请码显示'无限次 · 已使用 N 次'", async () => {
    const codes: InvitationCodeRow[] = [
      sampleCode({ id: "code-un", code: "UNLIMITED01", max_uses: null, used_count: 7 }),
    ];
    setupSupabaseMock({ fetchData: codes });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText(/无限次.*已使用.*7.*次/)).toBeInTheDocument();
      expect(screen.getByText("可用")).toBeInTheDocument();
    });
  });

  it("管理视图：空列表时显示'暂无邀请码'", async () => {
    setupSupabaseMock({ fetchData: [] });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText("暂无邀请码")).toBeInTheDocument();
    });
  });

  it("管理视图：加载失败时显示错误和重试按钮", async () => {
    setupSupabaseMock({ fetchError: { message: "权限不足" } });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
    });
  });

  it("管理视图：点击删除显示内联确认块", async () => {
    const codes: InvitationCodeRow[] = [sampleCode({ id: "code-del", code: "DELETE01" })];
    setupSupabaseMock({ fetchData: codes });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText("DELETE01")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));

    await waitFor(() => {
      expect(screen.getByText(/确认删除邀请码/)).toBeInTheDocument();
      // 确认块内显示邀请码文本——在确认块上下文中查找
      expect(screen.getByRole("button", { name: /确认删除/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /取消/ })).toBeInTheDocument();
    });

    // 内联确认块使用 danger 样式
    const confirmBlock = screen.getByText(/确认删除邀请码/).closest("div");
    expect(confirmBlock).toHaveClass("border-danger/30");
  });

  it("管理视图：确认删除成功后内联块消失", async () => {
    const codes: InvitationCodeRow[] = [sampleCode({ id: "code-del", code: "DELETE01" })];
    const deleteMock = vi.fn();
    const eqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const orderMock = vi.fn().mockResolvedValue({ data: codes, error: null });

    // 完整 mock：支持 select().order()（fetch）和 delete().eq()（删除）
    // 注意：deleteMock 需要返回 { eq: eqMock } 以支持链式调用
    (supabase.from as Mock).mockImplementation(() => ({
      select: vi.fn().mockReturnValue({ order: orderMock }),
      eq: eqMock,
      order: vi.fn().mockReturnThis(),
      delete: vi.fn(() => {
        deleteMock();
        return { eq: eqMock };
      }),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    }));

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /确认删除/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));

    await waitFor(() => {
      // .delete() 被调用过
      expect(deleteMock).toHaveBeenCalled();
      // .eq("id", "code-del") 被调用
      expect(eqMock).toHaveBeenCalledWith("id", "code-del");
    });

    await waitFor(() => {
      expect(screen.getByText("暂无邀请码")).toBeInTheDocument();
    });
  });

  it("管理视图：取消删除后内联块消失", async () => {
    const codes: InvitationCodeRow[] = [sampleCode({ id: "code-del", code: "DELETE01" })];
    setupSupabaseMock({ fetchData: codes });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/确认删除邀请码/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));

    await waitFor(() => {
      expect(screen.queryByText(/确认删除邀请码/)).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /^删除$/ })).not.toBeDisabled();
  });

  it("管理视图：确认块显示时删除按钮被禁用", async () => {
    const codes: InvitationCodeRow[] = [sampleCode({ id: "code-del", code: "DELETE01" })];
    setupSupabaseMock({ fetchData: codes });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /管理邀请码/ }));

    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/确认删除邀请码/)).toBeInTheDocument();
    });

    // 确认块显示时，删除按钮应被禁用
    expect(screen.getByRole("button", { name: /^删除$/ })).toBeDisabled();
  });

  // ---- 有效期输入测试（Issue #90 回归）----
  it("单个生成时可以设置有效期（天数）", async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: { id: "code-exp", code: "EXPIRE01", max_uses: 1, used_count: 0 },
      error: null,
    });
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: singleMock,
    });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText("有效期（天数）")).toBeInTheDocument();
    });

    // 使用 placeholder 定位有效期输入框（placeholder="1-30"）
    const expiresInput = screen.getByPlaceholderText("1-30") as HTMLInputElement;

    // 默认值为 7 天
    expect(expiresInput.value).toBe("7");

    // 修改为 14 天
    fireEvent.change(expiresInput, { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
      // 验证 expires_at 存在（精确时间由时区决定）
      expect(inserted.expires_at).toBeDefined();
    });
  });

  it("有效期输入限制在 1-30 天范围内（UI 层 clamp）", async () => {
    setupSupabaseMock({ fetchData: [] });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      expect(screen.getByText("有效期（天数）")).toBeInTheDocument();
    });

    const expiresInput = screen.getByPlaceholderText("1-30") as HTMLInputElement;

    // 输入超过 30，应该被 clamp 到 30
    fireEvent.change(expiresInput, { target: { value: "50" } });
    expect(expiresInput.value).toBe("30");

    // 输入负数，应该被 clamp 到 1
    fireEvent.change(expiresInput, { target: { value: "-5" } });
    expect(expiresInput.value).toBe("1");
  });

  // ---- 批量生成 1 个时的复制按钮测试（Issue #90 回归）----
  it("批量生成 1 个时显示'复制全部'按钮", async () => {
    const singleBatchResult = [
      {
        id: "batch-1",
        code: "SINGLE01",
        max_uses: 1,
        used_count: 0,
        created_by: "test-admin-id",
        created_at: new Date().toISOString(),
      },
    ];
    const selectMock = vi.fn().mockResolvedValue({ data: singleBatchResult, error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });

    // 设置数量为 1
    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // 显示生成结果（1 个）
      expect(screen.getByText(/生成结果.*1.*个/)).toBeInTheDocument();
      expect(screen.getByText("SINGLE01")).toBeInTheDocument();
      // 批量模式下应显示"复制全部"按钮
      expect(screen.getByRole("button", { name: /复制全部/ })).toBeInTheDocument();
    });
  });

  it("批量生成多个时显示'复制全部'按钮", async () => {
    const batchCodes = Array.from({ length: 3 }, (_, i) => ({
      id: `batch-${i}`,
      code: `BATCH${i.toString().padStart(2, "0")}`,
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    }));
    const selectMock = vi.fn().mockResolvedValue({ data: batchCodes, error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    setupSupabaseMock({
      fetchData: [],
      insertData: insertMock,
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(screen.getByText(/生成结果.*3.*个/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /复制全部/ })).toBeInTheDocument();
    });
  });

  it("单个生成模式不显示'复制全部'按钮，只显示逐条复制", async () => {
    const singleResult = {
      id: "code-1",
      code: "SINGLE01",
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    };
    const singleMock = vi.fn().mockResolvedValue({ data: singleResult, error: null });
    setupSupabaseMock({
      fetchData: [],
      insertData: { select: vi.fn().mockReturnThis(), single: singleMock },
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByRole("button", { name: /^生成$/ });
    });

    // 单个生成模式
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(screen.getByText("SINGLE01")).toBeInTheDocument();
      // 单个模式应显示逐条"复制"按钮
      expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
      // 不应显示"复制全部"按钮
      expect(screen.queryByRole("button", { name: /复制全部/ })).not.toBeInTheDocument();
    });
  });

  // ---- 邮件签名 Modal（G2 竞态守卫回归）----

  it("签名 Modal：快速开关时旧响应不覆盖新值（请求序号守卫）", async () => {
    // 第一次请求挂起（模拟慢网络），第二次请求立即返回
    let resolveSlow: (value: unknown) => void = () => {};
    const slowResponse = new Promise((resolve) => {
      resolveSlow = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => slowResponse)
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ key: "email_signature", value: "新签名" }),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfilePage />);
    const openBtn = screen.getByRole("button", { name: /邮件签名设置/ });

    // 第一次打开：慢请求挂起，Modal 显示"加载中…"
    fireEvent.click(openBtn);
    // fetch 在 await getSession() 之后才调用（微任务），需等待
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    // 通过 Modal 标题栏"关闭"按钮关闭，再重新打开：触发第二次请求
    fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    fireEvent.click(openBtn);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // 第二次请求先返回：textarea 显示新签名
    await waitFor(() => {
      expect(screen.getByPlaceholderText("如：北京大学交响乐团管理团队")).toHaveValue("新签名");
    });

    // 慢请求后到（旧响应）：应被序号守卫丢弃，不覆盖已显示的新签名
    resolveSlow({
      ok: true,
      status: 200,
      json: async () => ({ key: "email_signature", value: "旧签名" }),
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("如：北京大学交响乐团管理团队")).toHaveValue("新签名");
    });
  });
});
