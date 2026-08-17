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
