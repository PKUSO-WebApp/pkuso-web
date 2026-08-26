// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePosts } from "../usePosts";

function mockClient<T>(responses: T[]) {
  let i = 0;
  const uploadPaths: string[] = [];
  const removeCalls: string[][] = [];
  const eqCalls: string[][] = [];
  const orCalls: string[] = [];
  const c = (r: T) => ({
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, String(val)]);
      return c(r);
    },
    or: (cond: string) => {
      orCalls.push(cond);
      return c(r);
    },
    maybeSingle: () => c(r),
    order: () => c(r),
    // update().eq().select("id") 的 0 行检测链（usePosts.update）
    select: () => c(r),
    then: (resolve: (v: T) => void) => resolve(r),
  });
  return {
    from: () => ({
      select: () => c(responses[i++]),
      insert: () => ({ select: () => c(responses[i++]) }),
      update: () => ({ eq: () => c(responses[i++]) }),
      delete: () => ({ eq: () => c(responses[i++]) }),
    }),
    storage: {
      from: () => ({
        upload: (path: string) => {
          uploadPaths.push(path);
          return c(responses[i++]);
        },
        remove: (paths: string[]) => {
          removeCalls.push(paths);
          return c(responses[i++]);
        },
        getPublicUrl: () => responses[i++], // 同步,不 then
      }),
    },
    uploadPaths, // 记录 storage.upload 收到的路径，供断言
    removeCalls, // 记录 storage.remove 收到的路径数组，供断言（0 行检测守卫）
    eqCalls, // 记录查询链 eq 过滤条件，供断言（is_locked / author_id）
    orCalls, // 记录查询链 or 条件，供断言（excludeUserLocked）
  };
}

describe("usePosts", () => {
  it("fetch 加载帖子", async () => {
    const c = mockClient([{ data: [{ id: "1", title: "测试" }], error: null }]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
  });

  it("fetch 按 authorId 过滤：个人面板只查本人帖子（含锁定帖由 includeLocked 配合，Issue #205）", async () => {
    const c = mockClient([{ data: [], error: null }]); // fetch
    const { result } = renderHook(() =>
      usePosts({ client: c as never, includeLocked: true, authorId: "u1" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // includeLocked: true → 不追加 is_locked 过滤；authorId → 追加 author_id 过滤
    expect(c.eqCalls).not.toContainEqual(["is_locked", "false"]);
    expect(c.eqCalls).toContainEqual(["author_id", "u1"]);
    // 未开启 excludeUserLocked → 不追加 or 过滤（创建者自锁帖对自己可见）
    expect(c.orCalls).toHaveLength(0);
  });

  it("excludeUserLocked：管理端排除「创建者自锁」帖（未锁定与 admin 锁定仍可见）", async () => {
    const c = mockClient([{ data: [], error: null }]); // fetch
    const { result } = renderHook(() =>
      usePosts({ client: c as never, includeLocked: true, excludeUserLocked: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // includeLocked + excludeUserLocked → 不用 eq(is_locked)，改用 or 条件：
    // 保留 is_locked=false 的行，或 locked_by≠'user' 的行（admin 锁定/null 归属）
    expect(c.eqCalls).not.toContainEqual(["is_locked", "false"]);
    expect(c.orCalls).toContainEqual("is_locked.is.false,locked_by.neq.user");
  });

  it("create 发布帖子", async () => {
    const c = mockClient([
      { data: [], error: null }, // fetch
      { data: [{ id: "1", title: "新帖子", author_id: "u1" }], error: null }, // insert（乐观更新，无需再 fetch）
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ title: "新帖子", author_id: "u1" });
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("update 更新帖子：命中 1 行返回 true 并乐观更新本地数据", async () => {
    const c = mockClient([
      { data: [{ id: "1", title: "原标题" }], error: null }, // fetch
      { data: [{ id: "1" }], error: null }, // update .select("id") 命中 1 行
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.update("1", { title: "新标题" });
    });
    expect(ok).toBe(true);
    expect(result.current.data[0]).toMatchObject({ title: "新标题" });
  });

  it("update 0 行（RLS 静默失败/记录已被删除）返回 false，不乐观更新且清理旧 error", async () => {
    const c = mockClient([
      { data: [{ id: "1", title: "原标题" }], error: null }, // fetch
      { data: null, error: { message: "网络错误" } }, // 第一次 update：dbError
      { data: [], error: null }, // 第二次 update：0 行
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const ok = await result.current.update("1", { title: "A" });
      expect(ok).toBe(false);
    });
    expect(result.current.error).toBe("网络错误");

    await act(async () => {
      const ok = await result.current.update("1", { title: "B" });
      expect(ok).toBe(false);
    });
    // 0 行分支不报新错，并清理旧 error（避免后续 alert 误导文案）
    expect(result.current.error).toBeNull();
    // 0 行时本地数据不被乐观更新，避免假成功
    expect(result.current.data[0]).toMatchObject({ title: "原标题" });
  });

  it("remove 删除帖子：命中 1 行返回 true 并移除本地数据", async () => {
    const c = mockClient([
      { data: [{ id: "1" }], error: null }, // fetch
      { data: null, error: null }, // select image_url（无图片）
      { data: [{ id: "1" }], error: null }, // delete .select("id") 命中 1 行
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.remove("1");
    });
    expect(ok).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("remove 0 行（并发已删/RLS 静默失败）返回 false，不移除本地数据", async () => {
    const c = mockClient([
      { data: [{ id: "1" }], error: null }, // fetch
      { data: null, error: null }, // select image_url（无图片）
      { data: [], error: null }, // delete 0 行（无 error 的假成功）
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.remove("1");
    });
    expect(ok).toBe(false);
    // 0 行时本地数据不被移除，避免上层假成功（如对已删帖子插删除通知）
    expect(result.current.data).toHaveLength(1);
  });

  it("remove 0 行但帖子有图：返回 false 且不清理 storage 图片（附件清理守卫）", async () => {
    const c = mockClient([
      { data: [{ id: "1", image_url: "http://img/1.jpg" }], error: null }, // fetch
      { data: { image_url: "http://cdn/community-images/u1/a.jpg" }, error: null }, // select image_url（有图）
      { data: [], error: null }, // delete 0 行（无 error 的假成功）
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.remove("1");
    });
    expect(ok).toBe(false);
    // 0 行时本地数据不被移除
    expect(result.current.data).toHaveLength(1);
    // 0 行时跳过附件清理：图片可能仍被其他引用（双管理员并发删帖的败者不删图），
    // 附件删除必须发生在确认行删除成功之后（usePosts.remove 的守卫顺序）
    expect(c.removeCalls).toHaveLength(0);
  });

  it("uploadImage 上传图片", async () => {
    const c = mockClient([
      { data: [], error: null }, // fetch
      { data: null, error: null }, // upload
      { data: { publicUrl: "http://img/1.jpg" } }, // getPublicUrl
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = await act(() => result.current.uploadImage(new File([], "test.jpg"), "u1"));
    expect(r).toHaveProperty("url", "http://img/1.jpg");
  });

  it("uploadImage 消毒含中文/空格的文件名（Storage InvalidKey）", async () => {
    const c = mockClient([
      { data: [], error: null }, // fetch
      { data: null, error: null }, // upload
      { data: { publicUrl: "http://img/1.png" } }, // getPublicUrl
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = await act(() =>
      result.current.uploadImage(new File([], "屏幕截图 2025-11-11 201007.png"), "u1"),
    );
    expect(r).toHaveProperty("url", "http://img/1.png");
    // 消毒后 storage key 为纯 ASCII，不含中文/空格，且保留扩展名
    expect(c.uploadPaths[0]).not.toMatch(/[一-龥\s]/);
    expect(c.uploadPaths[0]).toMatch(/^[A-Za-z0-9._/-]+$/);
    expect(c.uploadPaths[0]).toContain(".png");
    // 不含日期分隔的空格：空格应被替换为 "-"，而非删除
    expect(c.uploadPaths[0]).toContain("-201007.png");
  });
});
