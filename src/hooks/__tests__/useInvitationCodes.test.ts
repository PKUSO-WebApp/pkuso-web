// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useInvitationCodes } from "../useInvitationCodes";
import type { InvitationCodeRow } from "@/types/database";

/**
 * 构造 mock supabase 客户端
 * responses 数组按调用顺序排列，每次 select/insert/update/delete 消费一条
 */
function mockClient(responses: unknown[]) {
  let i = 0;
  const chain = (res: unknown) => ({
    eq: () => chain(res),
    in: () => chain(res),
    maybeSingle: () => chain(res),
    single: () => chain(res),
    order: () => chain(res),
    limit: () => chain(res),
    select: () => chain(res),
    then: (resolve: (v: unknown) => void) => resolve(res),
  });
  return {
    from: () => ({
      select: () => chain(responses[i++]),
      update: () => ({ eq: () => chain(responses[i++]) }),
      insert: () => ({
        select: () => chain(responses[i++]),
        single: () => chain(responses[i++]),
      }),
      delete: () => ({ eq: () => chain(responses[i++]) }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "test-token" } } }),
      getUser: () =>
        Promise.resolve({ data: { user: { id: "admin-1", email: "admin@test.com" } } }),
    },
  };
}

const sampleCode: InvitationCodeRow = {
  id: "code-1",
  code: "ABCDEFGH",
  created_at: "2024-01-01T00:00:00Z",
  created_by: "admin-1",
  expires_at: null,
  max_uses: null,
  used: false,
  used_by: null,
  used_count: 0,
};

describe("useInvitationCodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- fetch ----
  it("fetch 成功返回邀请码列表，按创建时间倒序", async () => {
    const codes: InvitationCodeRow[] = [
      { ...sampleCode, id: "code-2", created_at: "2024-01-02T00:00:00Z" },
      { ...sampleCode, id: "code-1", created_at: "2024-01-01T00:00:00Z" },
    ];
    const c = mockClient([{ data: codes, error: null }]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0].id).toBe("code-2");
    expect(result.current.data[1].id).toBe("code-1");
  });

  it("fetch 失败设置 error 并清空 data", async () => {
    const c = mockClient([{ data: null, error: { message: "权限不足" } }]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("权限不足");
    expect(result.current.data).toEqual([]);
  });

  it("fetch 竞态保护：旧请求返回不覆盖新数据", async () => {
    // 用延迟模拟：第一次请求慢，第二次请求快，验证最终 data 是第二次的结果
    const slowData = [{ ...sampleCode, id: "old", code: "OLDCODE1" }];
    const fastData = [{ ...sampleCode, id: "new", code: "NEWCODE1" }];

    let firstResolve!: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      firstResolve = resolve;
    });

    let callCount = 0;
    const chain = (res: unknown, isSlow = false) => ({
      eq: () => chain(res, isSlow),
      order: () => chain(res, isSlow),
      select: () => chain(res, isSlow),
      then: (resolve: (v: unknown) => void) => {
        if (isSlow) {
          void firstPromise.then(() => resolve(res));
        } else {
          resolve(res);
        }
      },
    });

    const c = {
      from: () => ({
        select: () => {
          callCount += 1;
          if (callCount === 1) {
            return chain({ data: slowData, error: null }, true);
          }
          return chain({ data: fastData, error: null }, false);
        },
      }),
    };

    const { result } = renderHook(() => useInvitationCodes(c as never));

    // 第一次 fetch（慢）
    void act(() => {
      void result.current.fetch();
    });
    // 第二次 fetch（快，立即返回）
    await act(async () => {
      await result.current.fetch();
    });

    // 此时 data 应该是第二次的结果
    expect(result.current.data[0].id).toBe("new");

    // 让第一次请求返回
    await act(async () => {
      firstResolve({ data: slowData, error: null });
      // 等一帧让 React 更新
      await new Promise((r) => setTimeout(r, 10));
    });

    // data 不应被旧请求覆盖
    expect(result.current.data[0].id).toBe("new");
  });

  // ---- createSingle ----
  it("createSingle 成功创建并插入到列表头部", async () => {
    const newCode = { ...sampleCode, id: "new-code", code: "NEWCODE1" };
    const c = mockClient([
      { data: [sampleCode], error: null }, // fetch
      { data: newCode, error: null }, // insert.single
    ]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });
    expect(result.current.data).toHaveLength(1);

    let created: InvitationCodeRow | null = null;
    await act(async () => {
      created = await result.current.createSingle();
    });

    expect(created).not.toBeNull();
    expect(created!.code).toHaveLength(8);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0].id).toBe("new-code");
    expect(result.current.creating).toBe(false);
  });

  it("createSingle 失败设置 error 并返回 null", async () => {
    const c = mockClient([
      { data: [sampleCode], error: null }, // fetch
      { data: null, error: { message: "创建失败" } }, // insert.single
    ]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    let created: InvitationCodeRow | null = sampleCode;
    await act(async () => {
      created = await result.current.createSingle();
    });

    expect(created).toBeNull();
    expect(result.current.error).toBe("创建失败");
    expect(result.current.data).toHaveLength(1); // 不改变列表
    expect(result.current.creating).toBe(false);
  });

  it("createSingle 执行期间 creating 为 true（UI 层依赖此状态禁用按钮防重复）", async () => {
    const newCode = { ...sampleCode, id: "new-code", code: "NEWCODE1" };
    let insertResolve!: (value: unknown) => void;
    let creatingDuringCall: boolean | null = null;

    const c = {
      from: () => ({
        select: () => ({
          order: () => ({
            then: (resolve: (v: unknown) => void) => resolve({ data: [sampleCode], error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () => ({
              then: (resolve: (v: unknown) => void) => {
                insertResolve = resolve;
                // 异步延迟，模拟网络请求
                setTimeout(() => resolve({ data: newCode, error: null }), 30);
              },
            }),
          }),
        }),
      }),
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: "admin-1", email: "admin@test.com" } } }),
      },
    };

    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    expect(result.current.creating).toBe(false);

    // 开始创建，不 await
    void act(() => {
      const promise = result.current.createSingle();
      // 在微任务中检查 creating 状态（此时 setCreating 已执行）
      void promise.then(() => {
        // do nothing
      });
    });

    // 等一帧让 React 更新 state
    await waitFor(() => expect(result.current.creating).toBe(true));
    creatingDuringCall = result.current.creating;

    // 完成创建
    await act(async () => {
      insertResolve({ data: newCode, error: null });
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(creatingDuringCall).toBe(true);
    expect(result.current.creating).toBe(false);
    expect(result.current.data).toHaveLength(2);
  });

  it("createSingle 生成的邀请码为 8 位大写字母数字，不含易混淆字符", async () => {
    const c = mockClient([
      { data: [], error: null },
      { data: sampleCode, error: null },
    ]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    // 检查 mock 返回的邀请码格式
    await act(async () => {
      const created = await result.current.createSingle();
      expect(created).not.toBeNull();
      expect(created!.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    });
  });

  it("createSingle 支持自定义邀请码内容", async () => {
    let insertData: Record<string, unknown> | null = null;
    const customCode = { ...sampleCode, id: "custom-code", code: "MY-INVITE-001" };

    const c = {
      from: () => ({
        select: () => ({
          order: () => ({
            then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
          }),
        }),
        insert: (data: Record<string, unknown>) => {
          insertData = data;
          return {
            select: () => ({
              single: () => ({
                then: (resolve: (v: unknown) => void) => resolve({ data: customCode, error: null }),
              }),
            }),
          };
        },
      }),
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: "admin-1", email: "admin@test.com" } } }),
      },
    };

    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    let created: InvitationCodeRow | null = null;
    await act(async () => {
      created = await result.current.createSingle({ customCode: "MY-INVITE-001" });
    });

    expect(created).not.toBeNull();
    expect(created!.code).toBe("MY-INVITE-001");
    expect(insertData!.code).toBe("MY-INVITE-001");
    expect(insertData!.max_uses).toBe(1); // 默认使用次数
  });

  it("createSingle 支持自定义使用次数", async () => {
    let insertData: Record<string, unknown> | null = null;
    const newCode = { ...sampleCode, id: "multi-use", code: "ABCDEFGH", max_uses: 5 };

    const c = {
      from: () => ({
        select: () => ({
          order: () => ({
            then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
          }),
        }),
        insert: (data: Record<string, unknown>) => {
          insertData = data;
          return {
            select: () => ({
              single: () => ({
                then: (resolve: (v: unknown) => void) => resolve({ data: newCode, error: null }),
              }),
            }),
          };
        },
      }),
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: "admin-1", email: "admin@test.com" } } }),
      },
    };

    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    let created: InvitationCodeRow | null = null;
    await act(async () => {
      created = await result.current.createSingle({ maxUses: 5 });
    });

    expect(created).not.toBeNull();
    expect(insertData!.max_uses).toBe(5);
  });

  it("createSingle maxUses 为 0 或负数时被拒绝", async () => {
    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    // maxUses = 0 应被拒绝
    let created: InvitationCodeRow | null = null;
    await act(async () => {
      created = await result.current.createSingle({ maxUses: 0 });
    });
    expect(created).toBeNull();
    await waitFor(() => expect(result.current.error).toContain("最大使用次数"));
  });

  it("createSingle maxUses 超过上限 9999 时被拒绝", async () => {
    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    let created: InvitationCodeRow | null = null;
    await act(async () => {
      created = await result.current.createSingle({ maxUses: 999999 });
    });
    expect(created).toBeNull();
    await waitFor(() => expect(result.current.error).toContain("最大使用次数"));
  });

  it("createSingle customCode 超过 20 字符时被拒绝", async () => {
    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    let created: InvitationCodeRow | null = null;
    await act(async () => {
      created = await result.current.createSingle({ customCode: "THIS-CODE-IS-WAY-TOO-LONG" });
    });
    expect(created).toBeNull();
    await waitFor(() => expect(result.current.error).toContain("最多"));
  });

  it("createSingle customCode 含非法字符时被拒绝", async () => {
    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    let created: InvitationCodeRow | null = null;
    await act(async () => {
      created = await result.current.createSingle({ customCode: "MY CODE" });
    });
    expect(created).toBeNull();
    await waitFor(() => expect(result.current.error).toContain("仅支持"));
  });

  // ---- createBatch ----
  it("createBatch 成功批量创建并插入到列表头部", async () => {
    const batchCodes = [
      { ...sampleCode, id: "batch-1", code: "BATCH001" },
      { ...sampleCode, id: "batch-2", code: "BATCH002" },
      { ...sampleCode, id: "batch-3", code: "BATCH003" },
    ];
    const c = mockClient([
      { data: [sampleCode], error: null }, // fetch
      { data: batchCodes, error: null }, // insert.select
    ]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });
    expect(result.current.data).toHaveLength(1);

    let created: InvitationCodeRow[] = [];
    await act(async () => {
      created = await result.current.createBatch(3);
    });

    expect(created).toHaveLength(3);
    expect(result.current.data).toHaveLength(4);
    // 新创建的在头部
    expect(result.current.data[0].id).toBe("batch-1");
    expect(result.current.data[2].id).toBe("batch-3");
    expect(result.current.data[3].id).toBe("code-1");
    expect(result.current.creating).toBe(false);
  });

  it("createBatch 失败设置 error 并返回空数组", async () => {
    const c = mockClient([
      { data: [sampleCode], error: null }, // fetch
      { data: null, error: { message: "批量创建失败" } }, // insert.select
    ]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    let created: InvitationCodeRow[] = [sampleCode];
    await act(async () => {
      created = await result.current.createBatch(5);
    });

    expect(created).toEqual([]);
    expect(result.current.error).toBe("批量创建失败");
    expect(result.current.data).toHaveLength(1); // 不改变列表
    expect(result.current.creating).toBe(false);
  });

  it("createBatch 数量为 0 时仍走正常流程", async () => {
    // count=0 时 insert 空数组，预期返回空
    const c = mockClient([
      { data: [sampleCode], error: null }, // fetch
      { data: [], error: null }, // insert.select
    ]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    await act(async () => {
      const created = await result.current.createBatch(0);
      expect(created).toEqual([]);
    });

    expect(result.current.data).toHaveLength(1);
  });

  it("createBatch 执行期间 creating 为 true（UI 层依赖此状态禁用按钮防重复）", async () => {
    const batchCodes = [{ ...sampleCode, id: "batch-1", code: "BATCH001" }];
    let insertResolve!: (value: unknown) => void;
    let creatingDuringCall: boolean | null = null;

    const c = {
      from: () => ({
        select: () => ({
          order: () => ({
            then: (resolve: (v: unknown) => void) => resolve({ data: [sampleCode], error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            then: (resolve: (v: unknown) => void) => {
              insertResolve = resolve;
              setTimeout(() => resolve({ data: batchCodes, error: null }), 30);
            },
          }),
        }),
      }),
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: "admin-1", email: "admin@test.com" } } }),
      },
    };

    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    expect(result.current.creating).toBe(false);

    // 开始批量创建，不 await
    void act(() => {
      void result.current.createBatch(1);
    });

    // 等一帧让 React 更新 state
    await waitFor(() => expect(result.current.creating).toBe(true));
    creatingDuringCall = result.current.creating;

    // 完成创建
    await act(async () => {
      insertResolve({ data: batchCodes, error: null });
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(creatingDuringCall).toBe(true);
    expect(result.current.creating).toBe(false);
    expect(result.current.data).toHaveLength(2);
  });

  // ---- remove ----
  it("remove 成功删除并从列表中移除", async () => {
    const c = mockClient([
      { data: [sampleCode], error: null }, // fetch
      { error: null }, // delete.eq
    ]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });
    expect(result.current.data).toHaveLength(1);

    let ok = false;
    await act(async () => {
      ok = await result.current.remove("code-1");
    });

    expect(ok).toBe(true);
    expect(result.current.data).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.deleting).toBe(false);
  });

  it("remove 失败设置 error 并保留列表", async () => {
    const c = mockClient([
      { data: [sampleCode], error: null }, // fetch
      { error: { message: "删除失败" } }, // delete.eq
    ]);
    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    let ok = true;
    await act(async () => {
      ok = await result.current.remove("code-1");
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe("删除失败");
    expect(result.current.data).toHaveLength(1); // 保留
    expect(result.current.deleting).toBe(false);
  });

  it("remove 并发删除同一项时只执行一次", async () => {
    let deleteCallCount = 0;

    const c = {
      from: () => ({
        select: () => ({
          order: () => ({
            then: (resolve: (v: unknown) => void) => resolve({ data: [sampleCode], error: null }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            then: (resolve: (v: unknown) => void) => {
              deleteCallCount += 1;
              setTimeout(() => resolve({ error: null }), 50);
            },
          }),
        }),
      }),
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: "admin-1", email: "admin@test.com" } } }),
      },
    };

    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    // 并发删除同一项
    const [first, second] = await act(async () => {
      return Promise.all([result.current.remove("code-1"), result.current.remove("code-1")]);
    });

    expect(first).toBe(true);
    expect(second).toBe(false); // 第二次被阻止
    expect(deleteCallCount).toBe(1);
  });

  it("isDeleting 能正确反映正在删除中的项", async () => {
    let deleteResolve!: (value: unknown) => void;

    const c = {
      from: () => ({
        select: () => ({
          order: () => ({
            then: (resolve: (v: unknown) => void) => resolve({ data: [sampleCode], error: null }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            then: (resolve: (v: unknown) => void) => {
              deleteResolve = resolve;
            },
          }),
        }),
      }),
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: "admin-1", email: "admin@test.com" } } }),
      },
    };

    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    expect(result.current.isDeleting("code-1")).toBe(false);

    // 开始删除（不 await）
    void act(() => {
      void result.current.remove("code-1");
    });

    // 等一帧让状态更新
    await waitFor(() => expect(result.current.isDeleting("code-1")).toBe(true));
    expect(result.current.deleting).toBe(true);

    // 完成删除
    await act(async () => {
      deleteResolve({ error: null });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.isDeleting("code-1")).toBe(false);
    expect(result.current.deleting).toBe(false);
  });

  // ---- 无用户时 createSingle/createBatch 不填 created_by ----
  it("createSingle 无登录用户时不设置 created_by", async () => {
    const newCode = { ...sampleCode, id: "anon-code", code: "ANONCODE1", created_by: null };

    let insertData: Record<string, unknown> | null = null;

    const c = {
      from: () => ({
        select: () => ({
          order: () => ({
            then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
          }),
        }),
        insert: (data: Record<string, unknown>) => {
          insertData = data;
          return {
            select: () => ({
              single: () => ({
                then: (resolve: (v: unknown) => void) => resolve({ data: newCode, error: null }),
              }),
            }),
          };
        },
      }),
      auth: {
        getUser: () => Promise.resolve({ data: { user: null } }),
      },
    };

    const { result } = renderHook(() => useInvitationCodes(c as never));

    await act(async () => {
      await result.current.fetch();
    });

    await act(async () => {
      await result.current.createSingle();
    });

    expect(insertData).not.toBeNull();
    expect(insertData!.created_by).toBeUndefined();
  });
});
