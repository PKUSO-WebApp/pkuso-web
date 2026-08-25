// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import ProfilePage from "./page";
import { supabase } from "@/lib/supabase";
import { getFreshAccessToken } from "@/lib/auth-token";
import { EMAIL_SIGNATURE_MAX_LENGTH } from "@/lib/email-signature";
import { formatDateTimeInChina } from "@/lib/date-utils";
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
      // 邮件签名读取/保存的 token 通过 getFreshAccessToken 获取（fetchSignature / handleSaveSignature 使用）
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: "test-token" } }, error: null }),
    },
  },
}));

// 签名流程的 token 获取统一走 getFreshAccessToken（默认返回有效 token，
// 需要模拟登录过期时在具体用例中改为 mockResolvedValueOnce(null)）
vi.mock("@/lib/auth-token", () => ({
  getFreshAccessToken: vi.fn().mockResolvedValue("test-token"),
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

  it("生成邀请码防止重复提交（双击只插入一次）", async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: { id: "code-1", code: "ABCDEFGH", max_uses: 1, used_count: 0 },
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
      screen.getByRole("button", { name: /^生成$/ });
    });

    // 双击生成按钮（无 await 间隔，isGenSubmitting 尚未更新，仅 ref 同步 guard 生效）
    const genBtn = screen.getByRole("button", { name: /^生成$/ });
    fireEvent.click(genBtn);
    fireEvent.click(genBtn);

    await waitFor(() => {
      // invitation_codes 的 insert 只执行一次
      expect(insertMock).toHaveBeenCalledTimes(1);
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

  // ---- Issue #124 回归：token 获取失败（登录过期）时保存不发请求 ----

  it("签名保存：token 为 null 时不发请求并提示重新登录", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: "email_signature", value: "我的签名" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /邮件签名设置/ }));

    // 首次加载成功（token 有效），textarea 有值
    await waitFor(() => {
      expect(screen.getByPlaceholderText("如：北京大学交响乐团管理团队")).toHaveValue("我的签名");
    });

    // 模拟登录过期：getFreshAccessToken 返回 null
    (getFreshAccessToken as Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      expect(screen.getByText("登录状态异常，请重新登录")).toBeInTheDocument();
    });
    // 只发出过一次加载请求（GET），保存未发出请求
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 提交状态已复位，保存按钮可再次点击
    expect(screen.getByRole("button", { name: /^保存$/ })).not.toBeDisabled();
  });
});

// ---- Issue #125：签名编辑体验优化（rows=9 + 全屏编辑）----

describe("邮件签名全屏编辑", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const SIGNATURE_PLACEHOLDER = "如：北京大学交响乐团管理团队";

  /** 模拟 /api/admin/settings：GET 返回 initialValue，PUT 返回成功 */
  const mockSettingsFetch = (initialValue = "我的签名") =>
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ key: "email_signature", value: "已保存" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ key: "email_signature", value: initialValue }),
      });
    });

  /** 打开签名 Modal 并等待首次加载完成 */
  const openSigModal = async (fetchMock: Mock) => {
    vi.stubGlobal("fetch", fetchMock);
    const utils = render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /邮件签名设置/ }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(SIGNATURE_PLACEHOLDER)).toBeInTheDocument();
    });
    return utils;
  };

  /** 全屏覆盖层（Modal 仍打开，DOM 中共两个 dialog） */
  const getFullscreenOverlay = () => screen.getByRole("dialog", { name: "编辑邮件签名" });

  it("常规态：签名 textarea rows=9", async () => {
    await openSigModal(mockSettingsFetch());

    expect(screen.getByPlaceholderText(SIGNATURE_PLACEHOLDER)).toHaveAttribute("rows", "9");
  });

  it("点「全屏」：覆盖层出现，textarea 值与弹窗草稿一致（共用 state）", async () => {
    await openSigModal(mockSettingsFetch("草稿A"));

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));

    const overlay = getFullscreenOverlay();
    // 覆盖层与弹窗的 textarea 共用 sigValue，草稿未动
    expect(within(overlay).getByPlaceholderText(SIGNATURE_PLACEHOLDER)).toHaveValue("草稿A");
    // Modal 保持打开（两个 dialog），弹窗 textarea 仍在
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    expect(screen.getAllByPlaceholderText(SIGNATURE_PLACEHOLDER)).toHaveLength(2);
  });

  it("全屏中编辑后返回：草稿保留在弹窗", async () => {
    await openSigModal(mockSettingsFetch("草稿A"));

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();

    const overlayTextarea = within(overlay).getByPlaceholderText(SIGNATURE_PLACEHOLDER);
    fireEvent.change(overlayTextarea, { target: { value: "草稿B" } });

    fireEvent.click(within(overlay).getByRole("button", { name: /^返回$/ }));

    // 覆盖层关闭，弹窗内草稿保留
    expect(screen.queryByRole("dialog", { name: "编辑邮件签名" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(SIGNATURE_PLACEHOLDER)).toHaveValue("草稿B");
  });

  it("全屏点「保存」：调用 PUT，成功后关闭全屏回到弹窗并显示「签名已保存」", async () => {
    const fetchMock = mockSettingsFetch("我的签名");
    await openSigModal(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();
    fireEvent.click(within(overlay).getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      // 保存走 PUT /api/admin/settings
      const putCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
    });

    await waitFor(() => {
      // 成功：关闭全屏回到弹窗，弹窗显示"签名已保存"
      expect(screen.queryByRole("dialog", { name: "编辑邮件签名" })).not.toBeInTheDocument();
      expect(screen.getByText("签名已保存")).toBeInTheDocument();
    });
  });

  it("保存中：全屏关闭/返回/保存按钮禁用", async () => {
    await openSigModal(mockSettingsFetch());

    // 让保存挂起（getFreshAccessToken 不 resolve），保持 sigSubmitting=true
    const pendingToken = new Promise<never>(() => {});
    (getFreshAccessToken as Mock).mockImplementationOnce(() => pendingToken);

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();
    fireEvent.click(within(overlay).getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      expect(within(overlay).getByRole("button", { name: /保存中…/ })).toBeDisabled();
    });
    expect(within(overlay).getByLabelText("关闭全屏编辑")).toBeDisabled();
    expect(within(overlay).getByRole("button", { name: /^返回$/ })).toBeDisabled();
  });

  it("保存开始后焦点移入覆盖层根，根上按 Tab 被 preventDefault（焦点不逃逸出覆盖层）", async () => {
    await openSigModal(mockSettingsFetch());

    // 让保存挂起（getFreshAccessToken 不 resolve），保持 sigSubmitting=true
    const pendingToken = new Promise<never>(() => {});
    (getFreshAccessToken as Mock).mockImplementationOnce(() => pendingToken);

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();
    fireEvent.click(within(overlay).getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      expect(within(overlay).getByRole("button", { name: /保存中…/ })).toBeDisabled();
    });

    // 关键前提：保存开始后（覆盖层内全部按钮 disabled），焦点被主动移入覆盖层根。
    // 真实浏览器中 disabled 持焦会把 activeElement 移到 body（HTML focus fixup；
    // jsdom 不模拟），之后 Tab 的 keydown target 是 body、不冒泡到覆盖层，焦点循环
    // 收不到事件 → preventDefault 不生效；实现侧把焦点主动移到覆盖层根（tabIndex=-1），
    // 保证后续 keydown 一定从覆盖层内（根节点或其后代）冒泡
    expect(document.activeElement).toBe(overlay);

    // 保存中覆盖层内全部按钮 disabled：无可聚焦元素（触发空列表拦截分支）
    expect(getOverlayFocusables(overlay)).toHaveLength(0);

    // 覆盖层根上按 Tab：必须被拦截（preventDefault），
    // 否则浏览器默认 Tab 会让焦点逃逸到覆盖层外（如「退出登录」），Enter 误触直接登出丢草稿
    const preventDefaulted = fireEvent.keyDown(overlay, { key: "Tab" }) === false;
    expect(preventDefaulted).toBe(true);
    // 焦点未逃逸出覆盖层：仍停留在覆盖层根（元素恢复可用后焦点循环自然恢复）
    expect(document.activeElement).toBe(overlay);
  });

  it("全屏打开时锁定背景滚动，关闭后恢复", async () => {
    await openSigModal(mockSettingsFetch());
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(within(getFullscreenOverlay()).getByRole("button", { name: /^返回$/ }));
    expect(document.body.style.overflow).toBe("");
  });

  it("组件卸载时恢复背景滚动", async () => {
    const { unmount } = await openSigModal(mockSettingsFetch());

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  // ---- Issue #129 回归（对抗审查 S1）：全屏打开时底层 Modal 必须 inert 隔离 ----

  it("全屏打开时底层 Modal 被 inert 隔离（Tab 无法逃逸误触「关闭」丢草稿）", async () => {
    await openSigModal(mockSettingsFetch());

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();
    const modalDialog = screen.getAllByRole("dialog").find((d) => d !== overlay);
    expect(modalDialog).toBeDefined();
    // 底层弹窗容器带 inert：不可聚焦、不可点击，Tab 无法逃逸
    expect(modalDialog!.parentElement).toHaveAttribute("inert");
  });

  it("关闭全屏后底层 Modal 解除 inert 隔离", async () => {
    await openSigModal(mockSettingsFetch());

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();

    fireEvent.click(within(overlay).getByRole("button", { name: /^返回$/ }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "编辑邮件签名" })).not.toBeInTheDocument();
    });
    // 覆盖层关闭后，弹窗恢复可交互（不再 inert）
    expect(screen.getByRole("dialog").parentElement).not.toHaveAttribute("inert");
  });

  it("关闭全屏后焦点归还给弹窗「全屏」按钮", async () => {
    await openSigModal(mockSettingsFetch());

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();
    fireEvent.click(within(overlay).getByRole("button", { name: /^返回$/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /全屏$/ })).toHaveFocus();
    });
  });

  // ---- Issue #129 回归：保存失败留在全屏 + maxLength ----

  it("全屏保存失败：留在全屏并显示错误提示", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: "保存失败：服务器错误" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ key: "email_signature", value: "草稿A" }),
      });
    });
    await openSigModal(fetchMock as Mock);

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();
    fireEvent.click(within(overlay).getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      // 保存失败：仍停留在全屏覆盖层，错误提示可见
      expect(getFullscreenOverlay()).toBeInTheDocument();
      expect(within(getFullscreenOverlay()).getByText("保存失败：服务器错误")).toBeInTheDocument();
    });
  });

  it("覆盖层 textarea 限制 maxLength=500", async () => {
    await openSigModal(mockSettingsFetch());

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();

    expect(within(overlay).getByPlaceholderText(SIGNATURE_PLACEHOLDER)).toHaveAttribute(
      "maxlength",
      String(EMAIL_SIGNATURE_MAX_LENGTH),
    );
  });

  // ---- 对抗复验：全屏覆盖层焦点循环（focus trap）----
  // 按 DOM 顺序收集覆盖层内可聚焦元素：✕ 关闭 → textarea → 返回 → 保存

  /** 收集覆盖层内当前可聚焦元素（与实现侧 handleFullscreenKeyDown 的四重过滤规则一致：
      disabled / aria-hidden="true" / tabIndex<0（含覆盖层根 tabIndex=-1）/ 位于 [inert] 内） */
  const getOverlayFocusables = (overlay: HTMLElement) =>
    Array.from(overlay.querySelectorAll<HTMLElement>("button, textarea, [tabindex]")).filter(
      (el) => {
        if (el.hasAttribute("disabled")) return false;
        if (el.getAttribute("aria-hidden") === "true") return false;
        if (el.tabIndex < 0) return false;
        if (el.closest("[inert]")) return false;
        return true;
      },
    );

  it("全屏中 Tab：末元素（保存）按 Tab 循环回首元素（✕ 关闭），焦点不逃逸到页面", async () => {
    await openSigModal(mockSettingsFetch());

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();

    const focusables = getOverlayFocusables(overlay);
    expect(focusables.length).toBeGreaterThanOrEqual(4);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    expect(last).toHaveFocus();

    // fireEvent 返回 dispatchEvent 结果：handler 调用 preventDefault 时为 false
    const preventDefaulted = fireEvent.keyDown(last, { key: "Tab" }) === false;
    expect(preventDefaulted).toBe(true);
    // 焦点循环回首元素，末元素不再持有焦点
    expect(first).toHaveFocus();
    expect(document.activeElement).not.toBe(last);
  });

  it("全屏中 Shift+Tab：首元素（✕ 关闭）按 Shift+Tab 循环到末元素（保存）", async () => {
    await openSigModal(mockSettingsFetch());

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();

    const focusables = getOverlayFocusables(overlay);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    expect(first).toHaveFocus();

    const preventDefaulted = fireEvent.keyDown(first, { key: "Tab", shiftKey: true }) === false;
    expect(preventDefaulted).toBe(true);
    expect(last).toHaveFocus();
  });

  it("全屏中在中间元素（textarea）按 Tab 不触发循环（preventDefault 不被调用）", async () => {
    await openSigModal(mockSettingsFetch());

    fireEvent.click(screen.getByRole("button", { name: /全屏$/ }));
    const overlay = getFullscreenOverlay();

    // 中间元素：覆盖层 textarea（唯一可输入控件）
    const middle = within(overlay).getByPlaceholderText(SIGNATURE_PLACEHOLDER);
    middle.focus();
    expect(middle).toHaveFocus();

    const preventDefaulted = fireEvent.keyDown(middle, { key: "Tab" }) === false;
    expect(preventDefaulted).toBe(false);
    // 焦点不被循环逻辑改动，交由浏览器默认 Tab 顺序
    expect(middle).toHaveFocus();
  });
});

// ---- Issue #209：反馈列表（成员匿名反馈，只读展示）----

describe("反馈列表（Issue #209）", () => {
  const sampleFeedback = (overrides: Record<string, unknown> = {}) => ({
    id: "f1",
    content: "希望增加曲库功能",
    created_at: "2026-08-18T10:00:00+08:00",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("渲染「反馈列表」按钮", () => {
    render(<ProfilePage />);
    expect(screen.getByRole("button", { name: /反馈列表/ })).toBeInTheDocument();
  });

  it("打开弹窗时查询 feedback 表：内容 + 提交时间倒序渲染", async () => {
    const feedbacks = [
      sampleFeedback(),
      sampleFeedback({ id: "f2", content: "签到太麻烦", created_at: "2026-08-17T09:00:00+08:00" }),
    ];
    const { orderMock } = setupSupabaseMock({ fetchData: feedbacks });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /反馈列表/ }));

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith("feedback");
      expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
      expect(screen.getByText("希望增加曲库功能")).toBeInTheDocument();
      expect(screen.getByText("签到太麻烦")).toBeInTheDocument();
    });
    // 时间用与页面相同的格式化函数计算期望值，避免时区依赖
    const expectedTime1 = formatDateTimeInChina("2026-08-18T10:00:00+08:00");
    const expectedTime2 = formatDateTimeInChina("2026-08-17T09:00:00+08:00");
    expect(screen.getByText(expectedTime1)).toBeInTheDocument();
    expect(screen.getByText(expectedTime2)).toBeInTheDocument();
  });

  it("空列表显示「暂无反馈」", async () => {
    setupSupabaseMock({ fetchData: [] });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /反馈列表/ }));

    await waitFor(() => {
      expect(screen.getByText("暂无反馈")).toBeInTheDocument();
    });
  });

  it("加载失败：显示「加载失败」与重试按钮，点击重试重新查询并成功", async () => {
    setupSupabaseMock({ fetchError: { message: "网络错误" } });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /反馈列表/ }));

    await waitFor(() => {
      expect(screen.getByText("加载失败，请稍后重试")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
    });
    expect(screen.queryByText("暂无反馈")).toBeNull();

    // 点击重试：第二次查询成功，列表渲染
    setupSupabaseMock({ fetchData: [sampleFeedback()] });
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));

    await waitFor(() => {
      expect(screen.getByText("希望增加曲库功能")).toBeInTheDocument();
      expect(screen.queryByText("加载失败，请稍后重试")).toBeNull();
    });
  });

  it("竞态守卫：快速开关弹窗时过期响应被丢弃（递增序号范式）", async () => {
    const cbs: ((v: unknown) => void)[] = [];
    // orderMock 挂起不 resolve，收集回调后手动触发（模拟慢网络）
    const orderMock = vi.fn().mockImplementation(() => {
      const p = new Promise<unknown>((resolve) => {
        cbs.push(resolve);
      });
      return p;
    });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    (supabase.from as Mock).mockReturnValue({
      select: selectMock,
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    const openBtn = screen.getByRole("button", { name: /反馈列表/ });
    // 第一次打开：查询 1 挂起
    fireEvent.click(openBtn);
    // 关闭再打开：查询 2 挂起（弹窗内标题栏与底部各有一个「关闭」，取第一个）
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]);
    fireEvent.click(openBtn);
    expect(cbs).toHaveLength(2);

    // 乱序返回：查询 2（最新）先返回，查询 1（过期）后返回
    await act(async () => {
      cbs[1]({
        data: [{ id: "f2", content: "最新反馈", created_at: "2026-08-18T10:00:00+08:00" }],
        error: null,
      });
    });
    await act(async () => {
      cbs[0]({
        data: [{ id: "f1", content: "过期反馈", created_at: "2026-08-17T09:00:00+08:00" }],
        error: null,
      });
    });
    // 展示最新查询结果，过期响应被丢弃
    expect(screen.getByText("最新反馈")).toBeInTheDocument();
    expect(screen.queryByText("过期反馈")).toBeNull();
  });

  // ---- Issue #210：反馈治理（删除入口，走 service role API route）----

  it("删除：confirm 取消不调用删除 API", async () => {
    setupSupabaseMock({ fetchData: [sampleFeedback()] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /反馈列表/ }));
    await waitFor(() => {
      expect(screen.getByText("希望增加曲库功能")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalledWith("确定删除这条反馈吗？删除后不可恢复");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("希望增加曲库功能")).toBeInTheDocument();
  });

  it("删除成功：调用 DELETE API（带 Bearer）并从列表移除", async () => {
    setupSupabaseMock({ fetchData: [sampleFeedback()] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /反馈列表/ }));
    await waitFor(() => {
      expect(screen.getByText("希望增加曲库功能")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/admin/feedback?id=f1", {
        method: "DELETE",
        headers: { Authorization: "Bearer test-token" },
      });
      expect(screen.queryByText("希望增加曲库功能")).toBeNull();
    });
  });

  it("删除失败（404）：alert 提示且行保留", async () => {
    setupSupabaseMock({ fetchData: [sampleFeedback()] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "反馈不存在或已被删除" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /反馈列表/ }));
    await waitFor(() => {
      expect(screen.getByText("希望增加曲库功能")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("反馈不存在或已被删除");
    });
    expect(screen.getByText("希望增加曲库功能")).toBeInTheDocument();
  });

  it("删除进行中：按钮显示「删除中…」且全部禁用，防重复删除", async () => {
    setupSupabaseMock({
      fetchData: [
        sampleFeedback(),
        sampleFeedback({
          id: "f2",
          content: "签到太麻烦",
          created_at: "2026-08-17T09:00:00+08:00",
        }),
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveFetch!: (v: unknown) => void;
    const fetchSpy = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /反馈列表/ }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    // handler 先 await getSession 再调 fetch——等待 fetch 被调用（此时 promise 挂起，resolveFetch 已赋值）
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    // 进行中：第一行按钮显示「删除中…」，两行删除按钮全部禁用
    expect(screen.getByRole("button", { name: "删除中…" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "删除" })[0]).toBeDisabled();
    // 完成：列表移除 f1，f2 按钮恢复
    await act(async () => {
      resolveFetch({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    await waitFor(() => {
      expect(screen.queryByText("希望增加曲库功能")).toBeNull();
      expect(screen.getByText("签到太麻烦")).toBeInTheDocument();
    });
  });
});

// ---- Issue #227：发布系统通知（向全体已批准成员广播 + 历史列表）----
// 弹窗内 Tab 分离「发送通知」/「历史通知」（默认发送）；历史相关断言需先切 tab

describe("发布系统通知（Issue #227）", () => {
  const sampleNotify = (overrides: Record<string, unknown> = {}) => ({
    id: "n1",
    title: "元旦汇演通知",
    content: "请于 12 月 31 日 19:00 到场",
    created_at: "2026-08-20T10:00:00+08:00",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("渲染「发布系统通知」按钮（乐团事务组内，位于设置组「反馈列表」上方）", () => {
    render(<ProfilePage />);
    const notifyBtn = screen.getByRole("button", { name: /发布系统通知/ });
    const feedbackBtn = screen.getByRole("button", { name: /反馈列表/ });
    // DOM 顺序（分组化后）：乐团事务组在前 → 发布系统通知先于设置组的反馈列表
    expect(
      notifyBtn.compareDocumentPosition(feedbackBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("Tab 分离：默认「发送通知」（撰写可见历史隐藏），切「历史通知」后反之", async () => {
    setupSupabaseMock({ fetchData: [sampleNotify()] });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /发布系统通知/ }));

    // 默认 tab：撰写区可见，历史列表不渲染
    expect(screen.getByPlaceholderText(/通知标题/)).toBeInTheDocument();
    expect(screen.queryByText("元旦汇演通知")).toBeNull();

    // 切到历史 tab：撰写区隐藏，历史渲染
    fireEvent.click(screen.getByRole("button", { name: "历史通知" }));
    await waitFor(() => {
      expect(screen.getByText("元旦汇演通知")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText(/通知标题/)).toBeNull();
  });

  it("打开弹窗时查询 system_notifications 表：标题 + 内容 + 时间倒序渲染", async () => {
    const rows = [
      sampleNotify(),
      sampleNotify({
        id: "n2",
        title: "旧通知",
        content: "旧内容",
        created_at: "2026-08-19T09:00:00+08:00",
      }),
    ];
    const { orderMock } = setupSupabaseMock({ fetchData: rows });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /发布系统通知/ }));
    // 历史列表在「历史通知」tab 下渲染
    fireEvent.click(screen.getByRole("button", { name: "历史通知" }));

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith("system_notifications");
      expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
      expect(screen.getByText("元旦汇演通知")).toBeInTheDocument();
      expect(screen.getByText("旧通知")).toBeInTheDocument();
    });
    expect(
      screen.getByText(formatDateTimeInChina("2026-08-20T10:00:00+08:00")),
    ).toBeInTheDocument();
  });

  it("空历史显示「暂无通知」", async () => {
    setupSupabaseMock({ fetchData: [] });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /发布系统通知/ }));
    fireEvent.click(screen.getByRole("button", { name: "历史通知" }));

    await waitFor(() => {
      expect(screen.getByText("暂无通知")).toBeInTheDocument();
    });
  });

  it("标题或内容为空时「发布」按钮禁用", async () => {
    setupSupabaseMock({ fetchData: [] });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /发布系统通知/ }));

    // 默认「发送通知」tab：撰写区直接可见
    const publishBtn = screen.getByRole("button", { name: "发布" });
    expect(publishBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/通知标题/), {
      target: { value: "重要通知" },
    });
    fireEvent.change(screen.getByPlaceholderText(/通知正文/), {
      target: { value: "请准时参加" },
    });
    expect(screen.getByRole("button", { name: "发布" })).toBeEnabled();
  });

  it("发布成功：调用 POST API（带 Bearer）→ 清空输入 + 显示成功 + 刷新历史", async () => {
    setupSupabaseMock({ fetchData: [] }); // 发布前空历史；发布后刷新仍返回空（fetchSpy 为成功）
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, count: 2 }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /发布系统通知/ }));

    // 默认「发送通知」tab：直接撰写并发布
    fireEvent.change(screen.getByPlaceholderText(/通知标题/), {
      target: { value: " 元旦汇演通知 " },
    });
    fireEvent.change(screen.getByPlaceholderText(/通知正文/), {
      target: { value: "请于 12 月 31 日 19:00 到场" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发布" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/admin/notify-system",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        }),
      );
    });
    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body);
    expect(callBody).toEqual({
      title: "元旦汇演通知", // 已 trim
      content: "请于 12 月 31 日 19:00 到场",
    });
    await waitFor(() => {
      expect(screen.getByText("已发布给全体已批准成员")).toBeInTheDocument();
    });
    // 输入已清空
    expect((screen.getByPlaceholderText(/通知标题/) as HTMLInputElement).value).toBe("");
  });

  it("发布失败：显示错误信息且不刷新为成功态", async () => {
    setupSupabaseMock({ fetchData: [] });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "标题与内容均不能为空" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /发布系统通知/ }));

    // 默认「发送通知」tab：直接撰写并发布
    fireEvent.change(screen.getByPlaceholderText(/通知标题/), {
      target: { value: "重要通知" },
    });
    fireEvent.change(screen.getByPlaceholderText(/通知正文/), {
      target: { value: "内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发布" }));

    await waitFor(() => {
      expect(screen.getByText("标题与内容均不能为空")).toBeInTheDocument();
    });
    expect(screen.queryByText("已发布给全体已批准成员")).toBeNull();
  });

  it("防重复提交：首次点击后 fetch 挂起，按钮禁用且二次点击不再调用", async () => {
    setupSupabaseMock({ fetchData: [] });
    let resolveFetch!: (v: unknown) => void;
    const fetchSpy = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /发布系统通知/ }));

    // 默认「发送通知」tab：直接撰写并发布
    fireEvent.change(screen.getByPlaceholderText(/通知标题/), {
      target: { value: "重要通知" },
    });
    fireEvent.change(screen.getByPlaceholderText(/通知正文/), {
      target: { value: "内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    // 进行中：按钮显示「发布中…」并禁用
    expect(screen.getByRole("button", { name: "发布中…" })).toBeDisabled();
    // 二次点击不应再发请求
    fireEvent.click(screen.getByRole("button", { name: "发布中…" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch({ ok: true, json: () => Promise.resolve({ success: true, count: 2 }) });
    });
    await waitFor(() => {
      expect(screen.getByText("已发布给全体已批准成员")).toBeInTheDocument();
    });
  });
});
