/**
 * `renderBandThumbs`（核实面板的按需出图）—— 三条纪律各有断言：**单页失败不牵连整份**、
 * **整份失败要抛**（由调用方说一句，不是静默空表）、**取消点在页之间**。
 *
 * ⚠️ 这一层**不碰 UI**，所以不走 `__tests__/upload-modal-harness`，自己一个 `pdfjs-dist` 假实现 ——
 * 面板那一层的用例（`__tests__/upload-modal-evidence.test.tsx`）用的是共享 harness，
 * 而那个 harness 的 `getPage` **不会抛**（「页对象建不出来」这条输入在那边造不出来）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderBandThumbs } from "./band-render";

const h = vi.hoisted(() => ({
  failGetPage: [] as number[],
  failDocument: false,
  getPageCalls: [] as number[],
  renders: [] as number[],
  numPages: 3,
  destroys: 0,
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: () => ({
    promise: h.failDocument
      ? Promise.reject(new Error("坏 PDF"))
      : Promise.resolve({
          numPages: h.numPages,
          getPage: async (n: number) => {
            h.getPageCalls.push(n);
            if (h.failGetPage.includes(n)) throw new Error(`第 ${n} 页取不到`);
            return {
              getViewport: ({ scale }: { scale: number }) => ({
                width: 100 * scale,
                height: 200 * scale,
              }),
              render: () => {
                h.renders.push(n);
                return { promise: Promise.resolve() };
              },
              cleanup: () => {},
            };
          },
        }),
    destroy: async () => {
      h.destroys += 1;
    },
  }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs", () => ({}));

/** jsdom 没有 canvas 实现；这里只需要「画得上、编得出 data URL」，不校验像素 */
beforeEach(() => {
  h.failGetPage = [];
  h.failDocument = false;
  h.getPageCalls = [];
  h.renders = [];
  h.numPages = 3;
  h.destroys = 0;
  HTMLCanvasElement.prototype.getContext = function () {
    return { fillStyle: "", fillRect: () => {}, drawImage: () => {} };
  } as never;
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,AAAA";
});

const aFile = () => new File([new Uint8Array([1, 2, 3])], "x.pdf", { type: "application/pdf" });

describe("renderBandThumbs", () => {
  it("某一页的 getPage 抛 ⇒ 只丢那一页，别的页照常出图", async () => {
    // 输入/状态：第 2 页的页对象建不出来（页被损坏 / 文件在选中之后被移走）
    // 修前：`getPage` 在 per-page 的 try 之外 ⇒ 整份中断，调用方永远停在「渲染中…」
    h.failGetPage = [2];
    const out = await renderBandThumbs(aFile(), [1, 2, 3], { isCancelled: () => false });
    expect([...out.keys()]).toEqual([1, 3]);
    expect(h.getPageCalls).toEqual([1, 2, 3]);
  });

  it("整份打不开 ⇒ 抛给调用方，不是静默返回空表；**加载失败也要销毁 worker**", async () => {
    h.failDocument = true;
    await expect(renderBandThumbs(aFile(), [1], { isCancelled: () => false })).rejects.toThrow(
      "坏 PDF",
    );
    // 这条正是那条纪律唯一生效的路：`await task.promise` 的抛点在 try 里，靠 finally 收尾
    expect(h.destroys).toBe(1);
  });

  it("取消 ⇒ 在**页之间**就停：后面的页不再取、不再画", async () => {
    let calls = 0;
    // 第一次问「取消了吗」时还没取消（于是第 1 页照画），第二次起取消
    const out = await renderBandThumbs(aFile(), [1, 2, 3], { isCancelled: () => ++calls > 1 });
    expect(h.getPageCalls).toEqual([1]);
    expect(h.renders).toEqual([1]);
    expect([...out.keys()]).toEqual([1]);
  });

  it("一开始就取消 ⇒ 一页都不取、一张都不画（文档照开照关，省的是渲染不是加载）", async () => {
    const out = await renderBandThumbs(aFile(), [1, 2, 3], { isCancelled: () => true });
    expect(h.getPageCalls).toEqual([]);
    expect(h.renders).toEqual([]);
    expect(out.size).toBe(0);
    expect(h.destroys).toBe(1);
  });

  it("页号越界 / 非法 ⇒ 静默跳过，不抛、也不多取", async () => {
    // 0（不可能有）、4（超过 3 页）、1.5（不是整数）都该在 `want` 里被挡掉
    const out = await renderBandThumbs(aFile(), [0, 4, 1.5, 3], { isCancelled: () => false });
    expect(h.getPageCalls).toEqual([3]);
    expect([...out.keys()]).toEqual([3]);
  });
});
