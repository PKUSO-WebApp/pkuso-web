// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePosts } from "../usePosts";

function mockClient<T>(responses: T[]) {
  let i = 0;
  const uploadPaths: string[] = [];
  const c = (r: T) => ({
    eq: () => c(r),
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
        remove: () => c(responses[i++]),
        getPublicUrl: () => responses[i++], // 同步,不 then
      }),
    },
    uploadPaths, // 记录 storage.upload 收到的路径，供断言
  };
}

describe("usePosts", () => {
  it("fetch 加载帖子", async () => {
    const c = mockClient([{ data: [{ id: "1", title: "测试" }], error: null }]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
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

  it("remove 删除帖子", async () => {
    const c = mockClient([
      { data: [{ id: "1" }], error: null }, // fetch
      { data: null, error: null }, // select image_url（无图片）
      { data: null, error: null }, // delete（乐观更新，无需再 fetch）
    ]);
    const { result } = renderHook(() => usePosts({ client: c as never }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("1");
    });
    await waitFor(() => expect(result.current.data).toEqual([]));
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
