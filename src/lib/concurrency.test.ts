import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "./concurrency";

/**
 * 「同时在飞几个」是时序相关的事实，从外面不好观测，所以让 worker 自己记账：
 * 进门 ++ 并记峰值、出门 --。用例里的 worker 全部卡在同一道闸门上，
 * 于是「峰值恰好 === limit」是**确定性**的而不是碰运气：
 * 去掉上界（改成 Promise.all 全放）峰值会变成项数，改成串行则变成 1，两种改法都会失败。
 */
function makeTracker() {
  let inFlight = 0;
  let peak = 0;
  return {
    enter() {
      inFlight++;
      peak = Math.max(peak, inFlight);
    },
    leave() {
      inFlight--;
    },
    get peak() {
      return peak;
    },
  };
}

/** 清空微任务队列（一个 macrotask 足够） */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runWithConcurrency", () => {
  it("同时在飞的项数恰好等于 limit（不多也不少），且按序领活", async () => {
    const tracker = makeTracker();
    const started: number[] = [];
    const gates: Array<() => void> = [];
    const gate = () => new Promise<void>((resolve) => gates.push(resolve));

    const done = runWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7, 8], 3, async (item) => {
      started.push(item);
      tracker.enter();
      await gate();
      tracker.leave();
    });

    // worker 体在第一个 await 之前是同步执行的，所以这 3 个已经站在闸门上了
    expect(started).toEqual([0, 1, 2]);
    expect(tracker.peak).toBe(3);

    // 放行一个 → 空出的坑位立刻领走 3 号，峰值不变
    gates.shift()!();
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(tracker.peak).toBe(3);

    // 逐个放行剩下的；每放行一个都可能补进新的一项
    while (gates.length > 0) {
      gates.shift()!();
      await flush();
    }
    await done;

    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tracker.peak).toBe(3);
  });

  it("每项恰好跑一次，worker 拿到的是 (item, 下标)", async () => {
    const seen: Array<[string, number]> = [];
    await runWithConcurrency(["a", "b", "c", "d", "e"], 2, async (item, i) => {
      seen.push([item, i]);
    });
    // 排序后再比：并发完成顺序本来就不保证，这里验的是配对与「一个不多一个不少」
    expect(seen.slice().sort((x, y) => x[1] - y[1])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
      ["e", 4],
    ]);
  });

  it("要等最慢的一项跑完才 resolve", async () => {
    const events: string[] = [];
    await runWithConcurrency([0, 1], 2, async (i) => {
      if (i === 1) await flush();
      events.push(`done-${i}`);
    });
    events.push("resolved");

    expect(events.indexOf("resolved")).toBeGreaterThan(events.indexOf("done-1"));
  });

  it("空数组是合法输入：不抛、不卡、不跑 worker", async () => {
    // 注意这是**退化情形，不是一条分支** —— 它是 `size = Math.min(0, …) = 0` 的必然结果，
    // 所以它抓不住任何实现细节（上一版用例被变异测试证明是空转的：删掉实现里那行空数组
    // 早退，用例照样全绿）。留着是为了钉住「空输入不会抛、也不会永远挂着」这个契约本身 ——
    // resolves 断言配 vitest 的超时，能抓住「池子在没有项时等一个永远不来的坑位」这类改法。
    for (const limit of [3, 0, -1, NaN, Infinity]) {
      let calls = 0;
      await expect(
        runWithConcurrency([], limit, async () => {
          calls++;
        }),
      ).resolves.toBeUndefined();
      expect(calls).toBe(0);
    }
  });

  it("limit 不是有效正数时钳到 1：退化成串行，但不会一项都不跑", async () => {
    for (const limit of [0, -3, NaN]) {
      const tracker = makeTracker();
      const seen: number[] = [];
      await runWithConcurrency([0, 1, 2], limit, async (i) => {
        tracker.enter();
        seen.push(i);
        tracker.leave();
      });
      expect(seen).toEqual([0, 1, 2]);
      expect(tracker.peak).toBe(1);
    }
  });

  it("某项抛错不中断其余项，全部跑完后整体 reject（抛第一个错）", async () => {
    const seen: number[] = [];
    const promise = runWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (i) => {
      seen.push(i);
      if (i === 0 || i === 3) throw new Error(`boom-${i}`);
    });

    await expect(promise).rejects.toThrow("boom-0");
    // 关键断言：两个 worker 各炸一次，剩下 4 项照样跑完了
    expect(seen.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
