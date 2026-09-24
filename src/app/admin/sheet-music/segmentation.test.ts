import { describe, expect, it } from "vitest";
import {
  boundarySpan,
  cutsToSegments,
  estimateOcrCalls,
  estimateTotalOcrCalls,
  mergeSegmentIntoPrev,
  moveSegmentStart,
  needsSegmentation,
  normalizeSegments,
  parseBoundaryText,
  segmentsFromResponse,
  splitSegment,
  startsFromResponse,
} from "./segmentation";

const ranges = (segs: Array<{ from: number; to: number }>) => segs.map((s) => [s.from, s.to]);
/** 段是否闭合覆盖 1..n：不留空洞、不重叠 —— 破了这条后面的切分与改名会错位 */
const covers = (segs: Array<{ from: number; to: number }>, n: number) =>
  segs.length > 0 &&
  segs[0].from === 1 &&
  segs[segs.length - 1].to === n &&
  segs.every((s, i) => s.from <= s.to && (i === 0 || s.from === segs[i - 1].to + 1));

describe("成本可见（验收标准：OCR 调用次数在导入前可见）", () => {
  it("**拼图后一份 19 页的谱只要 1 次 OCR**（一张长图装得下）", () => {
    expect(estimateTotalOcrCalls([{ pageCount: 19, eligible: true }])).toBe(1);
  });

  it("超过单张上限才分张 —— 这是**上界**（实际按真实大小贪心分组只会更少）", () => {
    expect(estimateOcrCalls(24)).toBe(1);
    expect(estimateOcrCalls(25)).toBe(2);
    expect(estimateOcrCalls(116)).toBe(5); // Egmont 那批：116 次 → 5 次
  });

  it("已经在手里的页不再重烧 —— 失败重试时按**缺的页**算", () => {
    expect(estimateOcrCalls(25, 24)).toBe(1); // 缺 1 页 → 1 次
    // 拿到的比页数还多（不该发生）不能算出负数
    expect(estimateOcrCalls(19, 25)).toBe(0);
  });

  it("不合格的文件不计入 —— 用户看到的数就是真实会烧的数", () => {
    expect(
      estimateTotalOcrCalls([
        { pageCount: 19, eligible: true },
        { pageCount: 3, eligible: false },
        { pageCount: null, eligible: true },
      ]),
    ).toBe(1); // 只有那 19 页那份算，且拼图后是 1 次
  });

  it("空列表是 0", () => {
    expect(estimateTotalOcrCalls([])).toBe(0);
  });
});

describe("哪些文件要跑（用户已定：对所有多页文件跑，总谱除外）", () => {
  it("多页 → 跑；单页 → 不跑（没有边界，白烧一次 OCR）", () => {
    expect(needsSegmentation(19, false)).toBe(true);
    expect(needsSegmentation(2, false)).toBe(true);
    expect(needsSegmentation(1, false)).toBe(false);
  });

  it("页数未知 → 不跑（拿不到页数就没法算成本，也没法判单页）", () => {
    expect(needsSegmentation(null, false)).toBe(false);
    expect(needsSegmentation(undefined as unknown as number, false)).toBe(false);
  });

  it("**总谱不参与切分检测**（用户已定；省掉最大的一笔 OCR）", () => {
    // ⚠️ 总谱认不出来（三个本地判据都被实测否掉，见 issue #290），
    // 只能靠人工标记 section='总谱' —— 所以这里收的是算好的 isFullScore
    expect(needsSegmentation(30, true)).toBe(false);
  });
});

describe("cuts → 段", () => {
  it("正常：切点把页切成闭合的段", () => {
    expect(ranges(cutsToSegments([7, 13, 17], 19))).toEqual([
      [1, 6],
      [7, 12],
      [13, 16],
      [17, 19],
    ]);
  });

  it("不切 = 整份一段", () => {
    expect(ranges(cutsToSegments([], 19))).toEqual([[1, 19]]);
  });

  it("第 1 页不是切点：写进去会被丢掉，段仍然从 1 开始", () => {
    expect(ranges(cutsToSegments([1, 7], 10))).toEqual([
      [1, 6],
      [7, 10],
    ]);
  });

  it("越界与重复的切点丢掉，不产生空洞", () => {
    const segs = cutsToSegments([0, -1, 99, 7, 7, 5.5], 10);
    expect(covers(segs, 10)).toBe(true);
    expect(ranges(segs)).toEqual([
      [1, 6],
      [7, 10],
    ]);
  });

  it("一页的文件就是一段", () => {
    expect(ranges(cutsToSegments([], 1))).toEqual([[1, 1]]);
  });

  it("**切点落在最后一页**：合法，最后一段就是那一页（`<=` 不能写成 `<`）", () => {
    expect(ranges(cutsToSegments([19], 19))).toEqual([
      [1, 18],
      [19, 19],
    ]);
  });
});

describe("用户改边界后的收敛", () => {
  it("移动起点后段重新闭合", () => {
    expect(ranges(normalizeSegments([7, 13, 17], 19))).toEqual([
      [1, 6],
      [7, 12],
      [13, 16],
      [17, 19],
    ]);
  });

  it("把某个起点删掉 = 合并两段", () => {
    expect(ranges(normalizeSegments([13, 17], 19))).toEqual([
      [1, 12],
      [13, 16],
      [17, 19],
    ]);
  });

  it("起点落到第 1 页：那条不是边界，被并进第 1 段", () => {
    const segs = normalizeSegments([1, 7], 10);
    expect(covers(segs, 10)).toBe(true);
    expect(ranges(segs)).toEqual([
      [1, 6],
      [7, 10],
    ]);
  });

  it("**任何输入都不能产生空洞或重叠**（破了这条后面的切分会错位）", () => {
    // ⚠️ 输入表里**必须有乱序**：全是升序的话 `.sort()` 一次都不会起作用，
    // 把它删掉这一整套用例仍然全绿（实测过）。
    for (const starts of [
      [],
      [1],
      [5],
      [3, 3, 3],
      [0, 5, 99],
      [-2, 4, 4, 7],
      [2, 3, 4, 5],
      [13, 7], // 乱序（界面走不到，但这是这一层的契约）
      [7, 2, 5], // 乱序 + 有个落在第 1 页的
      [5, 5, 2, 5], // 乱序 + 重复
    ]) {
      const segs = normalizeSegments(starts, 10);
      expect(covers(segs, 10), JSON.stringify(starts)).toBe(true);
    }
  });

  it("乱序输入会先排序：删掉 sort 会让段变成 from > to 且互相重叠", () => {
    expect(ranges(normalizeSegments([7, 2, 5], 10))).toEqual([
      [1, 1],
      [2, 4],
      [5, 6],
      [7, 10],
    ]);
  });

  it("页数为 0 / 负数时不产生段（不抛）", () => {
    expect(normalizeSegments([2], 0)).toEqual([]);
    expect(normalizeSegments([2], -1)).toEqual([]);
  });

  it("**页数不是安全整数**时也不产生段（穷举实测：违规只出现在这一档）", () => {
    // ⚠️ 这一组里**只有 3 个**有鉴别力（即：旧代码会给出错的段、新代码返回 []）：
    //   Infinity     → 旧：`{from: 1, to: Infinity}`（盖到无穷页）
    //   1.5          → 旧：`{from: 1, to: 1.5}`（非整数的段）
    //   MAX_SAFE+1+1 → 旧：`{from: 1, to: 9007199254740992}`
    // 另外两个**没有**鉴别力，留着只为钉契约（它们在新旧代码下都是 `[]`）：
    //   NaN       —— 旧代码里 `s <= NaN` 恒假 → 连恒含的 1 都被过滤掉 → 本来就 `[]`
    //                （那个 `{from: 1, to: NaN}` 是 `cutsToSegments` 去掉自身守卫时的形态，
    //                 不是这里）
    //   -Infinity —— 旧代码的 `pageCount < 1` 守卫当场挡住（`-Infinity < 1` 为真）
    // 把它们当成「旧代码的漏洞形态」是错的 —— 断言写对了期望值、却验错了东西。
    for (const pc of [NaN, Infinity, -Infinity, 1.5]) {
      expect(normalizeSegments([2], pc as unknown as number), String(pc)).toEqual([]);
    }
    expect(normalizeSegments([2], Number.MAX_SAFE_INTEGER + 2)).toEqual([]);
  });
});

describe("响应收敛：以 cuts 为准，不信 ranges", () => {
  it("正常 cuts", () => {
    expect(ranges(segmentsFromResponse([7, 13], 19))).toEqual([
      [1, 6],
      [7, 12],
      [13, 19],
    ]);
  });

  it("cuts 不是数组 / 是垃圾 → 退化成「不切」，不抛", () => {
    for (const bad of [null, undefined, "7", 7, {}, [null], ["7"], [NaN]]) {
      const segs = segmentsFromResponse(bad, 19);
      expect(ranges(segs), JSON.stringify(bad)).toEqual([[1, 19]]);
    }
  });

  it("pageCount 非法时也不抛（退化成一页一段是最安全的）", () => {
    expect(segmentsFromResponse([2], 0)).toEqual([]);
    expect(segmentsFromResponse([2], NaN as unknown as number)).toEqual([]);
  });

  it("**上线的起点直接用这个**（`startsFromResponse`）：恒含第 1 页、严格升序", () => {
    expect(startsFromResponse([13, 7, 7], 19)).toEqual([1, 7, 13]);
    expect(startsFromResponse("垃圾", 19)).toEqual([1]);
  });
});

describe("边界编辑：打字过程中的中间态绝不能删掉边界", () => {
  const START = [1, 7, 13, 17];
  const N = 19;

  /** 复刻组件的两步：输入只改「原文」，提交（失焦/回车）才解析 + 移动 */
  const typeThenCommit = (
    starts: number[],
    si: number,
    keys: string[],
    pageCount = N,
  ): { starts: number[]; rejected: boolean } => {
    const span = boundarySpan(starts, si, pageCount);
    if (!span) throw new Error("测试自己写错了：这个下标不是可动边界");
    let raw = "";
    for (const k of keys) raw += k; // 每次按键只更新原文，段不动
    const v = parseBoundaryText(raw, span.lo, span.hi);
    if (v === null) return { starts, rejected: true };
    return { starts: moveSegmentStart(starts, si, v, pageCount), rejected: false };
  };

  it("**回归（曾经的阻塞）**：敲两位数 `15` 不该销毁任何一段", () => {
    // 旧实现：受控值取归一化后的 `seg.from` + 每次 onChange 都提交
    // → 敲第一个字符 `1` 就让 7 那个切点被当成重复值合并掉，段从 4 条变 3 条，
    //   而恢复只能重跑整个分段（= 再烧 N 次 OCR）。
    const { starts, rejected } = typeThenCommit(START, 1, ["1", "5"]);
    // 15 越出这一段的可动区间（上一段从 13 起，上界是 12）→ 拒绝
    expect(rejected).toBe(true);
    expect(starts).toEqual(START);
  });

  it("**回归的另一半**：合法输入必须真的提交（拒绝不能变成「什么都改不了」）", () => {
    const { starts, rejected } = typeThenCommit(START, 1, ["1", "1"]);
    expect(rejected).toBe(false);
    expect(starts).toEqual([1, 11, 13, 17]);
  });

  it('清空输入框（原文 `""`）也不删边界', () => {
    const { starts, rejected } = typeThenCommit(START, 1, []);
    expect(rejected).toBe(true);
    expect(starts).toEqual(START);
  });

  it("五位数字、小数、负号、`1e3` 一律拒绝（`Number()` 会认后两个）", () => {
    for (const keys of [
      ["1", "e", "3"],
      ["1", ".", "5"],
      ["-", "3"],
      ["1", "2", "3", "4", "5"],
    ]) {
      const r = typeThenCommit(START, 1, keys);
      expect(r.rejected, keys.join("")).toBe(true);
      expect(r.starts).toEqual(START);
    }
  });

  it("合法输入才提交，且落在**这一段自己的**可动区间里", () => {
    expect(typeThenCommit(START, 1, ["5"]).starts).toEqual([1, 5, 13, 17]);
    expect(typeThenCommit(START, 1, ["1", "2"]).starts).toEqual([1, 12, 13, 17]);
    expect(typeThenCommit(START, 2, ["1", "6"]).starts).toEqual([1, 7, 16, 17]);
    // 最后一条边界的上界是 pageCount（它后面没有别的边界了）
    expect(typeThenCommit(START, 3, ["1", "9"]).starts).toEqual([1, 7, 13, 19]);
  });

  it("可动区间：`boundarySpan` 不含相邻边界本身（碰上了就是合并，得走显式操作）", () => {
    expect(boundarySpan([1, 7, 13, 17], 1, 19)).toEqual({ lo: 2, hi: 12 });
    expect(boundarySpan([1, 7, 13, 17], 3, 19)).toEqual({ lo: 14, hi: 19 });
    expect(boundarySpan([1, 7], 0, 19)).toBeNull(); // 第 0 段不是边界
    expect(boundarySpan([1, 7], 2, 19)).toBeNull(); // 越界
    expect(boundarySpan([1, 7], 1, 0)).toBeNull(); // 页数非法
  });

  it("文本解析只认纯数字串", () => {
    expect(parseBoundaryText("7", 2, 12)).toBe(7);
    expect(parseBoundaryText(" 7 ", 2, 12)).toBe(7);
    expect(parseBoundaryText("007", 2, 12)).toBe(7);
    // ⚠️ 这几个是**鉴别力**的关键：`Number()` 全都认，而且换算后的值**仍落在区间内**
    // （`1e1`=10、`0x7`=7、`7.`=7），所以「用 Number 代替正则」时只有它们会露馅。
    // 只放 `1e3` 是不够的 —— 那个越界，会被范围检查顺手挡掉，测不出正则这一层。
    for (const bad of ["", " ", "1", "13", "0", "1.5", "-3", "1e1", "0x7", "7.", "+7", "7a", "٧"]) {
      expect(parseBoundaryText(bad, 2, 12), bad).toBeNull();
    }
  });

  it("极长的数字串不会溢出成「合法值」", () => {
    expect(parseBoundaryText("9".repeat(30), 2, 12)).toBeNull();
  });

  it("解析→移动这一路，段永远闭合覆盖（不留空洞、不重叠）", () => {
    for (const keys of [["5"], ["9"], ["1"], ["1", "2"], ["1", "9"], [], ["1", "2", "3"]]) {
      for (let si = 1; si < START.length; si++) {
        const { starts } = typeThenCommit(START, si, keys);
        const segs = normalizeSegments(starts, N);
        expect(covers(segs, N), `${si}:${keys.join("")}`).toBe(true);
        expect(segs).toHaveLength(START.length); // 段数**永远**不变
      }
    }
  });
});

describe("加/删边界（模型漏切时人工补，后端刻意宁可少切）", () => {
  it("拆分：在段中间插一条边界，段数 +1", () => {
    expect(splitSegment([1, 7, 13, 17], 0, 19)).toEqual([1, 4, 7, 13, 17]);
    expect(splitSegment([1, 7, 13, 17], 3, 19)).toEqual([1, 7, 13, 17, 18]);
  });

  it("拆分后仍闭合覆盖，且新边界落在原段内部", () => {
    for (let i = 0; i < 4; i++) {
      const next = splitSegment([1, 7, 13, 17], i, 19);
      expect(covers(normalizeSegments(next, 19), 19), `段 ${i}`).toBe(true);
      expect(next).toHaveLength(5);
    }
  });

  it("只有一页的段拆不开（原样返回，用引用相等表示「没改」）", () => {
    const starts = [1, 2];
    expect(splitSegment(starts, 0, 2)).toBe(starts); // 第 0 段 = 1..1
    expect(splitSegment(starts, 1, 2)).toBe(starts); // 第 1 段 = 2..2
    expect(splitSegment(starts, 9, 2)).toBe(starts); // 越界
  });

  it("合并：删掉一条边界，段数 -1；第 0 段不是边界，删不动", () => {
    expect(mergeSegmentIntoPrev([1, 7, 13, 17], 1)).toEqual([1, 13, 17]);
    const starts = [1, 7];
    expect(mergeSegmentIntoPrev(starts, 0)).toBe(starts);
    expect(mergeSegmentIntoPrev(starts, 5)).toBe(starts);
  });

  it("合并后仍闭合覆盖", () => {
    expect(covers(normalizeSegments(mergeSegmentIntoPrev([1, 7, 13, 17], 2), 19), 19)).toBe(true);
  });

  it("拆分 → 合并 回到原状（用户点错了能退回来）", () => {
    const back = mergeSegmentIntoPrev(splitSegment([1, 7, 13, 17], 1, 19), 2);
    expect(back).toEqual([1, 7, 13, 17]);
  });

  it("页数非法时不动手（不抛、不产出 from>to 的段）", () => {
    for (const pc of [0, -1, NaN as unknown as number, 1.5]) {
      expect(splitSegment([1, 7], 0, pc)).toEqual([1, 7]);
      expect(moveSegmentStart([1, 7], 1, 5, pc)).toEqual([1, 7]);
      expect(boundarySpan([1, 7], 1, pc)).toBeNull();
    }
  });

  it("**移动这一层自己也要拒绝越界**（不能只靠上游的 `parseBoundaryText`）", () => {
    // 上面「解析→移动」那组用例里，越界值在**解析**那一步就被挡掉了，所以这一层的
    // 守卫没有测试盖着 —— 变异实测：把 `moveSegmentStart` 的守卫整个删掉，全绿。
    // 而这一层是最后一道闸：将来若有别的入口（响应路径、新的界面控件）绕过解析，
    // 落进来的就是越界值，`normalizeSegments` 会把它**当重复值丢掉**（= 删边界）。
    for (const bad of [1, 0, -3, 13, 19, 1.5, NaN]) {
      expect(moveSegmentStart([1, 7, 13, 17], 1, bad, 19), String(bad)).toEqual([1, 7, 13, 17]);
    }
    // 合法值正常落位（拒绝不能变成「什么都改不了」）
    expect(moveSegmentStart([1, 7, 13, 17], 1, 2, 19)).toEqual([1, 2, 13, 17]);
    expect(moveSegmentStart([1, 7, 13, 17], 1, 12, 19)).toEqual([1, 12, 13, 17]);
    // 下标本身非法也不动手
    expect(moveSegmentStart([1, 7], 0, 5, 19)).toEqual([1, 7]);
    expect(moveSegmentStart([1, 7], 9, 5, 19)).toEqual([1, 7]);
  });
});
