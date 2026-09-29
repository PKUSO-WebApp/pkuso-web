import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./random-id";

/** v4 形态：版本位 4、变体位 8/9/a/b。三个分支产出的都必须是这个形态。 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * 字节 0x00..0x0f 摆出来的那一串 —— 用来把「拼接顺序」「版本位」「变体位」钉死。
 * 若 slice 切错或忘了盖版本位，这里立刻红（只断言「像 UUID」是抓不到的）。
 */
const EXPECTED_FROM_SEQUENTIAL_BYTES = "00010203-0405-4607-8809-0a0b0c0d0e0f";

/**
 * 依次填 0x00,0x01,…，模拟一个**确定性**的随机源。
 * ⚠️ 必须**写进传入的数组**并把它返回（真实 `getRandomValues` 的契约）—— 早先这版
 * 返回了一个新数组，被测代码拿到的是全 0 字节，用例就空转了。
 */
function sequentialFillInto(arr: Uint8Array): Uint8Array {
  for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
  return arr;
}

const realGetRandomValues = webcrypto.getRandomValues.bind(webcrypto);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("randomId", () => {
  it("默认环境：形态是 v4，且 1000 次不重复", () => {
    const ids = Array.from({ length: 1000 }, () => randomId());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("有原生 randomUUID 时**优先用它**（不自己造）", () => {
    const native = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { ...webcrypto, randomUUID: native } as unknown as Crypto);

    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("没有 randomUUID（非安全上下文）时退回 getRandomValues，且字节摆成正确的 v4", () => {
    const getRandomValues = vi.fn((arr: Uint8Array) => sequentialFillInto(arr));
    // 关键：这个对象**没有** randomUUID —— 就是 http 局域网下的 `window.crypto`
    vi.stubGlobal("crypto", { getRandomValues } as unknown as Crypto);

    expect(randomId()).toBe(EXPECTED_FROM_SEQUENTIAL_BYTES);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it("退回 getRandomValues 那一支用的是真随机源：1000 次不重复", () => {
    vi.stubGlobal("crypto", { getRandomValues: realGetRandomValues } as unknown as Crypto);

    const ids = Array.from({ length: 1000 }, () => randomId());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("连 getRandomValues 都没有时退回 Math.random（仍不重复、仍是 v4）", () => {
    vi.stubGlobal("crypto", {} as Crypto);
    let n = 0;
    const spy = vi.spyOn(Math, "random").mockImplementation(() => (n++ % 256) / 256);

    const first = randomId();
    const second = randomId();
    expect(first).toBe(EXPECTED_FROM_SEQUENTIAL_BYTES);
    expect(second).not.toBe(first);
    expect(spy).toHaveBeenCalled();
  });

  it("crypto 整个不存在时也不抛", () => {
    vi.stubGlobal("crypto", undefined);

    expect(randomId()).toMatch(UUID_V4);
  });
});
