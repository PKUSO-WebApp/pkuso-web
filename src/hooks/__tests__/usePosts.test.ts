// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePosts } from "../usePosts";

function mockClient<T>(responses: T[]) {
  let i = 0;
  const c = (r: T) => ({
    eq: () => c(r),
    order: () => c(r),
    then: (resolve: (v: T) => void) => resolve(r),
  });
  return {
    from: () => ({
      select: () => c(responses[i++]),
      insert: () => c(responses[i++]),
      update: () => ({ eq: () => c(responses[i++]) }),
      delete: () => ({ eq: () => c(responses[i++]) }),
    }),
    storage: {
      from: () => ({
        upload: () => c(responses[i++]),
        getPublicUrl: () => responses[i++], // 同步,不 then
      }),
    },
  };
}

describe("usePosts", () => {
  it("fetch 加载帖子", async () => {
    const c = mockClient([{ data: [{ id: "1", title: "测试" }], error: null }]);
    const { result } = renderHook(() => usePosts(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
  });

  it("create 发布帖子", async () => {
    const c = mockClient([
      { data: [], error: null }, // fetch
      { data: null, error: null }, // insert
      { data: [{ id: "1" }], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => usePosts(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ title: "新帖子", author_id: "u1" });
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("remove 删除帖子", async () => {
    const c = mockClient([
      { data: [{ id: "1" }], error: null }, // fetch
      { data: null, error: null }, // delete
      { data: [], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => usePosts(c as never));
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
    const { result } = renderHook(() => usePosts(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = await act(() => result.current.uploadImage(new File([], "test.jpg"), "u1"));
    expect(r).toHaveProperty("url", "http://img/1.jpg");
  });
});
