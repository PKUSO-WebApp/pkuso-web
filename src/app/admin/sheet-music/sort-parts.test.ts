import { describe, expect, it } from "vitest";
import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from "@/constants/instruments";
import { compareFiles, sectionSortKey, sortPartsForDisplay } from "./sort-parts";

/**
 * 排序契约（pkuso-web#289）：声部按 `INSTRUMENT_ORDER`、**总谱最前**、**其他最后**；
 * 同声部内按乐器拼音；同乐器内按第一个分声部号、**没有号的最前**。
 */

// ⚠️ `sub_parts` 与 `section` 都**不再可空**（迁移 `20260926120000` / `20260926130000`）：
// 「没有分声部」是空数组，不是 null。夹具跟着改，免得多测一条已经不存在的分支。
type TestFile = { instrument: string | null; sub_parts: number[] };
const file = (instrument: string | null, sub_parts: number[]): TestFile => ({
  instrument,
  sub_parts,
});
const part = (section: string, files: TestFile[] = []) => ({ section, files });
const sectionsOf = (parts: { section: string }[]) => parts.map((p) => p.section);
const instrumentsOf = (files: { instrument: string | null }[]) => files.map((f) => f.instrument);

describe("sectionSortKey", () => {
  it("总谱最前，其余按 INSTRUMENT_ORDER", () => {
    expect(sectionSortKey(FULL_SCORE_SECTION)).toBeLessThan(sectionSortKey(INSTRUMENT_ORDER[0]));
    expect(sectionSortKey(INSTRUMENT_ORDER[0])).toBeLessThan(sectionSortKey(INSTRUMENT_ORDER[1]));
    expect(sectionSortKey(INSTRUMENT_ORDER[5])).toBeLessThan(sectionSortKey(INSTRUMENT_ORDER[6]));
  });

  it("「其他」排在所有标准声部之后", () => {
    expect(sectionSortKey(OTHER_INSTRUMENT_GROUP)).toBeGreaterThan(
      sectionSortKey(INSTRUMENT_ORDER[INSTRUMENT_ORDER.length - 1]),
    );
  });

  it("未知值（空串 / 闭集外）与「其他」同档，不会插进标准声部中间", () => {
    // 闭集外的值只可能来自 prompt 词表漂移；排在最后比混在正常声部里更容易被发现
    //（`section` 自 A1 的迁移起是 NOT NULL，所以这里不再有 NULL 那一档）
    const last = sectionSortKey(OTHER_INSTRUMENT_GROUP);
    expect(sectionSortKey("")).toBe(last);
    expect(sectionSortKey("木管")).toBe(last);
    expect(sectionSortKey("   ")).toBe(last);
  });

  it('声部名首尾空白被 trim（`" 长笛 "` 要落回长笛那一档，不是「未知」）', () => {
    // 没有这条时，删掉 `sectionSortKey` 里的 `.trim()` 也全绿 —— 唯一涉及空白的
    // 用例只喂了 `"   "`（三种写法都判未知），钉不住 trim 本身。
    expect(sectionSortKey(" 长笛 ")).toBe(sectionSortKey("长笛"));
    expect(sectionSortKey("\t圆号　")).toBe(sectionSortKey("圆号"));
  });

  it("16 个声部的**顺序**是跨仓契约（后端 prompt 词表与它逐字同序）", () => {
    // 这条把顺序本身钉死。上面那些用例拿 `INSTRUMENT_ORDER[i]` 与 `[i+1]` 互比，
    // 只要实现还用 indexOf 就恒真 —— 常量被人改序是抓不到的。
    expect([...INSTRUMENT_ORDER]).toEqual([
      "第一小提琴",
      "第二小提琴",
      "中提琴",
      "大提琴",
      "低音提琴",
      "长笛",
      "双簧管",
      "单簧管",
      "大管",
      "圆号",
      "小号",
      "长号",
      "大号",
      "打击乐",
      "键盘",
      "竖琴",
    ]);
  });
});

describe("compareFiles", () => {
  it("先按乐器名拼音", () => {
    const files = [file("钟琴", []), file("定音鼓", []), file("木琴", [])];
    const sorted = [...files].sort(compareFiles);
    // d < m < zh
    expect(instrumentsOf(sorted)).toEqual(["定音鼓", "木琴", "钟琴"]);
  });

  it("拼音要真的是拼音 —— 用**码点序与拼音序相反**的名字对", () => {
    // ⚠️ 上面那条夹具（定音鼓/木琴/钟琴）的期望顺序**恰好等于 UTF-16 码点序**
    // （定 U+5B9A < 木 U+6728 < 钟 U+949F），所以把比较器换成 `a < b` 也全绿：
    // 它区分不出「拼音」与「码点」。下面这三对才区分得出，且**每一对都取自线上真实数据**。
    //
    // 长笛(changdi) < 短笛(duandi)：码点序 长 U+957F > 短 U+77ED，方向相反
    expect(instrumentsOf([file("短笛", []), file("长笛", [])].sort(compareFiles))).toEqual([
      "长笛",
      "短笛",
    ]);
    // 长号(changhao) < 低音长号(diyinchanghao)
    expect(instrumentsOf([file("低音长号", []), file("长号", [])].sort(compareFiles))).toEqual([
      "长号",
      "低音长号",
    ]);
    // 拉丁开头的中文名：A调(atiao…) < 降E调(jiangetiao…)。
    // ⚠️ ICU 会把这类名字排到**所有中文名之后**，正是换掉 Intl.Collator 的原因。
    expect(
      instrumentsOf([file("降E调单簧管", []), file("A调单簧管", [])].sort(compareFiles)),
    ).toEqual(["A调单簧管", "降E调单簧管"]);
  });

  it("同乐器再按第一个分声部号", () => {
    const files = [file("圆号", [4]), file("圆号", [2]), file("圆号", [1, 3])];
    expect([...files].sort(compareFiles).map((f) => f.sub_parts)).toEqual([[1, 3], [2], [4]]);
  });

  it("**没有号的排最前** —— 空数组（「没有号」的唯一形态）用 0 做哨兵", () => {
    // 号恒 ≥ 1，所以「没有号」用 0 做哨兵就够了；`sub_parts` 自 A2 的迁移起 NOT NULL，
    // 所以「没有号」只有空数组这一种形态（历史行的 NULL 已经被回填掉了）
    const files = [file("木琴", [3]), file("木琴", []), file("木琴", []), file("木琴", [1])];
    expect([...files].sort(compareFiles).map((f) => f.sub_parts)).toEqual([[], [], [1], [3]]);
  });

  it("哨兵值本身要钉住：违法的 `[0]` 必须与「没有号」**同档**", () => {
    // ⚠️ 这条的写法是有讲究的。上一版只断言「[] 排在 [1] 之前」——
    // 把哨兵从 0 改成 -1 照样绿（都在 1 之前）。要区分 0 与 -1，必须构造一对
    // **排序结果会因哨兵取值而变**的输入：
    //   哨兵 0  ：[0]→0、[]→0  → 同档 → 稳定排序保持输入顺序 [[0], []]
    //   哨兵 -1 ：[0]→0、[]→-1 → [] 更小 → 变成 [[], [0]]
    // 于是这一条就把「0 是哨兵」钉死了。
    //
    // 语义上为什么该同档：`0` 不是合法的分声部号（合法号恒 ≥ 1），所以一行的号是
    // `[0]` 时它和「没有号」一样不可信 —— 应当由**基准序**决定位置，而不是让那个
    // 垃圾值参与比较。合法号恒 ≥ 1 这个前提只由两个仓库的**应用层**代码保证，
    // DB 层没有约束（`sub_parts` 是裸 `INTEGER[]`；加 CHECK 的事记在 pkuso-backend 待办）。
    expect(
      [...[file("木琴", [0]), file("木琴", [])].sort(compareFiles)].map((f) => f.sub_parts),
    ).toEqual([[0], []]);
    // 负数同理不是合法号，但它比哨兵更小 → 排在「没有号」之前。方向无害（都是垃圾），
    // 写下来是为了让这个行为是**被决定的**，而不是某天被顺手改掉的偶然。
    expect(
      [...[file("木琴", []), file("木琴", [-1])].sort(compareFiles)].map((f) => f.sub_parts),
    ).toEqual([[-1], []]);
    // 而真正的合法号必须排在所有这些之后
    expect(
      [...[file("木琴", [1]), file("木琴", [0]), file("木琴", [])].sort(compareFiles)].map(
        (f) => f.sub_parts,
      ),
    ).toEqual([[0], [], [1]]);
  });

  it("只有第一个号参与比较（多号文件按最小的那个定位）", () => {
    const files = [file("圆号", [2, 3, 4]), file("圆号", [1, 9])];
    expect([...files].sort(compareFiles).map((f) => f.sub_parts)).toEqual([
      [1, 9],
      [2, 3, 4],
    ]);
  });

  it("乐器名为 NULL 不抛错，按空串参与比较（排最前）", () => {
    const files = [file("圆号", []), file(null, [])];
    expect(instrumentsOf([...files].sort(compareFiles))).toEqual([null, "圆号"]);
  });
});

describe("sortPartsForDisplay", () => {
  it("总谱第一、其他最后，中间按 INSTRUMENT_ORDER", () => {
    const parts = [
      part(OTHER_INSTRUMENT_GROUP),
      part("圆号"),
      part(FULL_SCORE_SECTION),
      part("第一小提琴"),
    ];
    expect(sectionsOf(sortPartsForDisplay(parts))).toEqual([
      FULL_SCORE_SECTION,
      "第一小提琴",
      "圆号",
      OTHER_INSTRUMENT_GROUP,
    ]);
  });

  it("同时排好每个声部里的文件（三级排序一次到位）", () => {
    const parts = [part("圆号", [file("圆号", [4]), file("圆号", []), file("圆号", [1])])];
    expect(sortPartsForDisplay(parts)[0].files.map((f) => f.sub_parts)).toEqual([[], [1], [4]]);
  });

  it("**不修改入参** —— 调用方是 React state，原地排序会让引用比较失效", () => {
    const parts = [
      part(OTHER_INSTRUMENT_GROUP, [file("木琴", [1])]),
      part("圆号", [file("圆号", [1])]),
    ];
    const out = sortPartsForDisplay(parts);

    expect(sectionsOf(parts)).toEqual([OTHER_INSTRUMENT_GROUP, "圆号"]); // 入参顺序没变
    expect(out).not.toBe(parts); // 返回的是新数组

    // ⚠️ 断言必须**按声部配对**再比身份。早先这里写的是 `out[1].files !== parts[1].files`
    // —— 而 `out` 排完序后 `out[1]` 是**另一个声部**，两个本来就不是同一个数组，
    // 断言恒真。实测：把 `[...part.files].sort(...)` 改成原地 `part.files.sort(...)`
    // （真的破坏了调用方的 state），这条用例照样绿。
    for (const section of [OTHER_INSTRUMENT_GROUP, "圆号"]) {
      const before = parts.find((p) => p.section === section)!;
      const after = out.find((p) => p.section === section)!;
      expect(after.files, `${section} 的文件数组应是新数组`).not.toBe(before.files);
      expect(after.files[0], `${section} 的文件对象可以复用（只换容器）`).toBe(before.files[0]);
      expect(after, `${section} 的声部对象应是新对象`).not.toBe(before);
    }
  });

  it("空列表不抛错", () => {
    expect(sortPartsForDisplay([])).toEqual([]);
  });

  it("排序是稳定的：同档同乐器的保持传入顺序", () => {
    // 传入顺序来自查询的 created_at，是个确定的顺序 —— 至少不会每次刷新都跳
    const parts = [part("圆号", [file("圆号", [1]), file("圆号", [1])])];
    const out = sortPartsForDisplay(parts)[0].files;
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(parts[0].files[0]);
    expect(out[1]).toBe(parts[0].files[1]);
  });
});
