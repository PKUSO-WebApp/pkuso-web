// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const state = {
    data: [] as { id: string; title: string; composer: string | null }[],
    error: null as { message: string } | null,
    select: "",
    orders: [] as string[],
  };
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: (columns: string) => {
      state.select = columns;
      return chain;
    },
    order: (column: string) => {
      state.orders.push(column);
      return chain;
    },
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: state.error ? null : state.data, error: state.error }),
  });
  return { state, chain };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => mocks.chain },
}));

import { useSheetMusicOptions } from "../useSheetMusicOptions";

describe("useSheetMusicOptions", () => {
  it("查询 composer 并原样返回（同名曲目靠它区分）", async () => {
    mocks.state.select = "";
    mocks.state.orders = [];
    mocks.state.error = null;
    mocks.state.data = [
      { id: "s1", title: "第五交响曲", composer: "肖斯塔科维奇" },
      { id: "s2", title: "第五交响曲", composer: "舒伯特" },
    ];

    const { result } = renderHook(() => useSheetMusicOptions());

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(mocks.state.select).toContain("composer");
    expect(mocks.state.orders).toEqual(["title", "composer"]);
    expect(result.current[1]).toEqual({
      id: "s2",
      title: "第五交响曲",
      composer: "舒伯特",
    });
  });

  it("加载失败时返回空列表（表单仍可添加无谱曲目）", async () => {
    mocks.state.data = [];
    mocks.state.error = { message: "boom" };

    const { result } = renderHook(() => useSheetMusicOptions());

    await waitFor(() => expect(result.current).toEqual([]));
  });
});
