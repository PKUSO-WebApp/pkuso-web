/**
 * 窄带的**几何来源**（`renderBandThumbs` / `resolveBandPct`）。
 *
 * 四条纪律各有断言：
 * - **一份文档一个高度**：采样、取 max、越界/样本不足退 25%，所有页用同一个数；
 * - **量一次、到处复用**：同一 `File` 第二次不再重新渲染采样页（分段与面板缩略图
 *   共用这份缓存，而它们彼此不知道对方）；
 * - **单页失败不牵连整份**、**整份失败要抛**（由调用方说一句，不是静默空表）；
 * - **取消点在页之间**，且取消得到的 `null` **不缓存**（重开要能重新量）。
 *
 * ⚠️ 这一层**不碰 UI**，所以不走 `__tests__/upload-modal-harness`，自己一个
 * `pdfjs-dist` 假实现 —— 面板那一层的用例（`__tests__/upload-modal-evidence.test.tsx`）
 * 用的是共享 harness，而那个 harness 的 `getPage` **不会抛**（「页对象建不出来」
 * 这条输入在那边造不出来）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderBandThumbs } from "./band-render";

const h = vi.hoisted(() => ({
  failGetPage: [] as number[],
  failDocument: false,
  getPageCalls: [] as number[],
  renders: [] as number[],
  /** 最近一次 `page.render` 的页号 —— `getImageData` 据此造这一页的合成像素 */
  lastRender: 0,
  /** `drawImage` 的实参，按调用顺序（`bandThumb` 的九段式是 9 个参数） */
  draws: [] as unknown[][],
  /** 页号 → 第一谱线所在的页高比例（缺省 = 这一页白纸，检测不到谱线） */
  staffRatios: {} as Record<number, number>,
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
                h.lastRender = n;
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

/**
 * 一页的合成像素：白底 + 一组 5 条谱线 + 下方一组 3 条确认线（`findFirstStaffLine`
 * 要求「第一组 5 条、下面还有一组」）。间距取页高的 1%（落在检测器的 0.3%~1.5% 带内），
 * 连续暗段占页宽 80%（阈值 35%）。
 *
 * 这是**生产检测器的真实输入形状**，不是替它写死答案：`bandHeight` 仍然由
 * `findFirstStaffLineInImage` 从像素里量出来。
 */
function pixelsFor(pageNo: number, width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ratio = h.staffRatios[pageNo];
  if (ratio === undefined) return data;
  const first = Math.round(ratio * height);
  const gap = Math.max(1, Math.round(0.01 * height));
  const group = (start: number, count: number) => {
    for (let k = 0; k < count; k++) {
      const y = start + k * gap;
      if (y < 0 || y >= height) continue;
      for (let x = Math.round(width * 0.1); x < Math.round(width * 0.9); x++) {
        const i = (y * width + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  };
  group(first, 5);
  group(first + Math.round(0.18 * height), 3);
  return data;
}

beforeEach(() => {
  h.failGetPage = [];
  h.failDocument = false;
  h.getPageCalls = [];
  h.renders = [];
  h.lastRender = 0;
  h.draws = [];
  h.staffRatios = {};
  h.numPages = 3;
  h.destroys = 0;
  // jsdom 没有 canvas 实现；这里只需要「画得上、取得到像素、编得出 data URL」
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      fillStyle: "",
      fillRect: () => {},
      drawImage: (...args: unknown[]) => {
        h.draws.push(args);
      },
      getImageData: (_x: number, _y: number, w: number, ht: number) => ({
        data: pixelsFor(h.lastRender, w, ht),
      }),
    };
  } as never;
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,AAAA";
});

const aFile = () => new File([new Uint8Array([1, 2, 3])], "x.pdf", { type: "application/pdf" });

/** 九段式 `drawImage` 的源矩形高度 —— 也就是这一页窄带在整页画布上的像素高 */
const bandHeights = () => h.draws.filter((a) => a.length === 9).map((a) => a[4] as number);

describe("renderBandThumbs", () => {
  it("某一页的 getPage 抛 ⇒ 只丢那一页，别的页照常出图", async () => {
    // 输入/状态：第 2 页的页对象建不出来（页被损坏 / 文件在选中之后被移走）
    // 修前：`getPage` 在 per-page 的 try 之外 ⇒ 整份中断，调用方永远停在「渲染中…」
    h.failGetPage = [2];
    const out = await renderBandThumbs(aFile(), [1, 2, 3], { isCancelled: () => false });
    expect([...out.keys()]).toEqual([1, 3]);
    // 采样一轮（1/2/3）+ 出图一轮（1/2/3）：第 2 页两轮都取不到，其余页各取两次
    expect(h.getPageCalls).toEqual([1, 2, 3, 1, 2, 3]);
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
    // 前 3 次渲染是自适应高度的采样页；第 4 次是第 1 张缩略图。
    // 用「已经画了几页」当取消信号，而不是数 `isCancelled` 被调了几次（后者是实现的调用图）。
    const out = await renderBandThumbs(aFile(), [1, 2, 3], {
      isCancelled: () => h.renders.length >= 4,
    });
    expect(h.getPageCalls).toEqual([1, 2, 3, 1]);
    expect(h.renders).toEqual([1, 2, 3, 1]);
    expect([...out.keys()]).toEqual([1]);
  });

  it("一开始就取消 ⇒ 连文档都不打开（省的是解析与解码，不只是渲染）", async () => {
    const out = await renderBandThumbs(aFile(), [1, 2, 3], { isCancelled: () => true });
    expect(h.getPageCalls).toEqual([]);
    expect(h.renders).toEqual([]);
    expect(out.size).toBe(0);
    expect(h.destroys).toBe(0);
  });

  it("页号越界 / 非法 ⇒ 静默跳过，出图阶段不取它们", async () => {
    // 0（不可能有）、4（超过 3 页）、1.5（不是整数）都该在 `want` 里被挡掉
    const out = await renderBandThumbs(aFile(), [0, 4, 1.5, 3], { isCancelled: () => false });
    expect(h.getPageCalls).not.toContain(0);
    expect(h.getPageCalls).not.toContain(4);
    expect(h.getPageCalls).not.toContain(1.5);
    // 采样阶段会取 1/2/3；之后只应再取一次 3
    expect(h.getPageCalls.slice(-1)).toEqual([3]);
    expect([...out.keys()]).toEqual([3]);
  });

  it("一份文档一个高度：所有页的窄带同高，且取采样页的最大值", async () => {
    // 第 1 页 10%（续页），第 2、3 页 15%（标题页）。max = 15% ⇒ 600 × 0.15 = 90。
    // 逐页自适应会得到 60/90/90，min/中位数会得到 60 或 60~90 —— 都与 90/90/90 不同。
    h.staffRatios = { 1: 0.1, 2: 0.15, 3: 0.15 };
    await renderBandThumbs(aFile(), [1, 2, 3], { isCancelled: () => false });
    expect(bandHeights()).toEqual([90, 90, 90]);
  });

  it("只量到一页 ⇒ 整份退 25%（600 × 0.25 = 150），不是用那一页的 10%", async () => {
    // 一页读数分不清「文档性质」与「个别异常」。若实现没有 `BAND_MIN_DETECTED`，
    // 这里会得到 60 —— 标题页会被整块切掉。
    h.staffRatios = { 1: 0.1 };
    await renderBandThumbs(aFile(), [1], { isCancelled: () => false });
    expect(bandHeights()).toEqual([150]);
  });

  it("同一 File 只量一次：第二次出图直接复用缓存，不再重新采样", async () => {
    // 分段 OCR 与面板缩略图各调一次本模块、彼此不知道对方 —— 它们拿到必须是同一个数，
    // 也因此不该把整份文档的采样渲染做两遍。
    h.staffRatios = { 1: 0.1, 2: 0.1 };
    const file = aFile();
    await renderBandThumbs(file, [1], { isCancelled: () => false });
    const afterFirst = h.getPageCalls.length;
    await renderBandThumbs(file, [2], { isCancelled: () => false });
    // 第一次 = 采样 1/2/3 + 出图 1（4 次）；第二次只出图 2（1 次）
    expect(afterFirst).toBe(4);
    expect(h.getPageCalls).toEqual([1, 2, 3, 1, 2]);
    expect(bandHeights()).toEqual([60, 60]);
  });

  it("取消导致的 null 不缓存：重开面板要能重新量", async () => {
    h.staffRatios = { 1: 0.1, 2: 0.1 };
    const file = aFile();
    const first = await renderBandThumbs(file, [1], { isCancelled: () => true });
    expect(first.size).toBe(0);
    // 缓存了 null 的话，这次会直接返回空表（而且一次渲染都不做）
    const second = await renderBandThumbs(file, [1], { isCancelled: () => false });
    expect([...second.keys()]).toEqual([1]);
    expect(bandHeights()).toEqual([60]);
  });
});
