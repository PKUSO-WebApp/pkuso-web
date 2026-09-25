import { describe, expect, it } from "vitest";
import {
  fillMissingSubParts,
  formatSubParts,
  generateFileName,
  MAX_SUB_PARTS,
  overSubPartsCap,
  parseSubPartsInput,
  sanitizeSubParts,
} from "./sub-parts";

/**
 * 这些用例守的是**跨仓契约**（与 `pkuso-backend` 的 `parseSubParts` 同一份）
 * 与**用户手输**两侧。每条都对应一个具体的失败形态，不是凑覆盖率。
 */

describe("parseSubPartsInput：用户手输", () => {
  it("接受逗号分隔的数字，并升序去重", () => {
    expect(parseSubPartsInput("1").value).toEqual([1]);
    expect(parseSubPartsInput("1,2").value).toEqual([1, 2]);
    expect(parseSubPartsInput("1,2,3,4").value).toEqual([1, 2, 3, 4]);
    // 顺序与重复都归一到规范形态 —— 落进文件名与库的必须是同一个值
    expect(parseSubPartsInput("3,1").value).toEqual([1, 3]);
    expect(parseSubPartsInput("2,1,2").value).toEqual([1, 2]);
  });

  it("中文输入法下的全角逗号与顿号等价于半角逗号", () => {
    // 后端用同一套归一化。⚠️ 不一致的方向是「**前端拒、后端收**」而不是反过来 ——
    // 前端合法集是后端的子集，所以不一致永远表现为「界面拦住了后端本来能收的输入」。
    expect(parseSubPartsInput("1，2").value).toEqual([1, 2]);
    expect(parseSubPartsInput("1、2").value).toEqual([1, 2]);
    expect(parseSubPartsInput("1，2、3").value).toEqual([1, 2, 3]);
  });

  it("空白与多余逗号是格式噪声，不是内容", () => {
    expect(parseSubPartsInput("  1 , 2  ").value).toEqual([1, 2]);
    expect(parseSubPartsInput("1,2,").value).toEqual([1, 2]);
    expect(parseSubPartsInput(",1").value).toEqual([1]);
  });

  it("只有分隔符、一个数字都没有 —— 判非法，**不当成「没有分声部」**", () => {
    // 与空串的区别是有意的：空串是用户明确表示「没有号」，而一个孤零零的逗号
    // 是**没写完**。若把它当成 [] 放过，那一行会带着空号一路传上去 ——
    // 正是本 issue 要消灭的「静默丢掉号」。宁可当场提示一句。
    const r = parseSubPartsInput(",");
    expect(r.value).toEqual([]);
    expect(r.invalid).toBeTruthy();
  });

  it("空串 = 没有分声部，合法（也是用户清空后的形态）", () => {
    const r = parseSubPartsInput("");
    expect(r.value).toEqual([]);
    expect(r.invalid).toBeUndefined();
  });

  it("区间判非法 —— 提示**不能**把 `1-4` 偷偷展开成 `1,4`", () => {
    // ⚠️ 这条是本文件最要紧的一条：早先的实现用 `t.replace("-", ",")` 拼提示，
    // 于是 `1-4` 会提示用户「请写成 1,4」—— 那是个**不同**的集合，
    // 照着改的用户会得到一个错的号，而提示本身看着还挺贴心。
    const r = parseSubPartsInput("1-4");
    expect(r.value).toEqual([]);
    expect(r.invalid).toContain("1-4");
    expect(r.invalid).not.toContain("1,4");
    // ⚠️ 上面两条**不足以**说明走的是区间分支：通用文案「「1-4」不是数字…」同样满足
    // 它们（也含 `1-4`、也不含 `1,4`）。变异测试把区间分支整个删掉，那两条仍然绿。
    // 要真正锁住这一支，得断言只有它才会说的那句话。
    expect(r.invalid).toContain("不接受区间");
  });

  it("非数字、零、负数、小数、超范围一律非法且**不产出值**", () => {
    for (const bad of ["a", "1a", "1.5", "0", "-1", "1,,a", "١٢٣", "0x2", "1e2", "+2"]) {
      const r = parseSubPartsInput(bad);
      expect(r.value, `${bad} 不该解析出值`).toEqual([]);
      expect(r.invalid, `${bad} 应给出提示`).toBeTruthy();
    }
  });

  it("NFKC 折出来的数字**照收** —— 与后端同一套归一化（全角/带圈/上标/数学字母）", () => {
    // 中文输入法全角模式下敲的就是 `２`，而「中文输入法」正是这段归一化存在的理由。
    // 后端 `parseSubParts` 折这些（analyze.ts 里逐个断言过），前端少这一步就会把
    // 最常见的输入挡在门外、还弹一句「「２」不是数字」。
    expect(parseSubPartsInput("２").value).toEqual([2]);
    expect(parseSubPartsInput("１，２").value).toEqual([1, 2]);
    expect(parseSubPartsInput("１,２,３").value).toEqual([1, 2, 3]);
    expect(parseSubPartsInput("①,②").value).toEqual([1, 2]);
    expect(parseSubPartsInput("²").value).toEqual([2]);
    expect(parseSubPartsInput("𝟏,𝟐").value).toEqual([1, 2]);
    expect(parseSubPartsInput("¹").value).toEqual([1]);
    expect(parseSubPartsInput("₁").value).toEqual([1]);
  });

  it("NFKC 折完**仍不是数字**的一律弃权（不是 NFKC 放过了它们）", () => {
    // `Ⅰ`→`I`、`⑵`→`(2)`、`½`→`1⁄2`：折是折了，折完过不了 /^\d+$/。
    // 理由要记对，否则下次有人「修 NFKC」会把罗马数字放进来。
    expect(parseSubPartsInput("Ⅰ,Ⅱ").value).toEqual([]);
    expect(parseSubPartsInput("⑵").value).toEqual([]);
    expect(parseSubPartsInput("½").value).toEqual([]);
  });

  it("`0x2` 不是 2 —— 用正则而不是 parseInt（后端专门有这条用例）", () => {
    // parseInt("0x2") 在 `x` 处停住返回 0；Number("0x2") 是 2（十六进制 = 十进制 2）。
    // 两种「宽容」都会把噪声当成分声部号，而这是**唯一会产出错误数据**的那一类。
    expect(parseSubPartsInput("0x2").value).toEqual([]);
    expect(parseSubPartsInput("0x10").value).toEqual([]);
  });

  it("纯空白 = 空（合法），不是「非法」", () => {
    // 用户敲了几个空格没删干净，不该被拦下来、还给一句风马牛不相及的提示。
    // 靠的是函数开头那句 `raw.trim()` —— 只测带内容的输入是测不到它的。
    for (const blank of ["   ", "\t", "\n"]) {
      const r = parseSubPartsInput(blank);
      expect(r.value, JSON.stringify(blank)).toEqual([]);
      expect(r.invalid, JSON.stringify(blank)).toBeUndefined();
    }
  });

  it("个数上界与常量一致（边界正好在 MAX_SUB_PARTS）", () => {
    const atLimit = Array.from({ length: MAX_SUB_PARTS }, (_, i) => i + 1).join(",");
    expect(parseSubPartsInput(atLimit).value).toHaveLength(MAX_SUB_PARTS);
    expect(parseSubPartsInput(atLimit).invalid).toBeUndefined();

    const over = Array.from({ length: MAX_SUB_PARTS + 1 }, (_, i) => i + 1).join(",");
    expect(parseSubPartsInput(over).value).toEqual([]);
    expect(parseSubPartsInput(over).invalid).toBeTruthy();
  });

  it("上界看的是**去重后**的个数（后端有同款用例，且这条抓得住形态相关）", () => {
    // `MAX_SUB_PARTS + 8` 个 1 去重后只有 1 个号 —— 它落进文件名的就是 1 个，
    // 不该被上界拦下。上面那条边界用例全用互不相同的号，把实现从
    // `value.length` 换成 `tokens.length` 也照样绿（变异测试实测 M9 存活）。
    const dup = Array.from({ length: MAX_SUB_PARTS + 8 }, () => 1).join(",");
    expect(parseSubPartsInput(dup).value).toEqual([1]);
    expect(parseSubPartsInput(dup).invalid).toBeUndefined();
  });

  it("非法时 value 恒为空数组 —— 调用方据此拦下上传", () => {
    // uploadBlocker 只看 invalid；但万一有人漏判，落到 generateFileName 的
    // 也必须是 []（= 没有号），不能是半个解析结果
    for (const bad of ["1,a", "a", "1-4", "0"]) {
      expect(parseSubPartsInput(bad).value).toEqual([]);
    }
  });
});

describe("generateFileName", () => {
  it("没有号时不加后缀", () => {
    expect(generateFileName("木琴", [])).toBe("木琴.pdf");
  });

  it("**一份文件覆盖多个分声部时把号全列出来**（本 issue 的核心验收点）", () => {
    // IMSLP 的 Horn_1,_2,_3,_4.pdf。只写第一个号正是要消灭的那类错：
    // 把「含 1、2、3、4」记成「只有 1」。
    expect(generateFileName("圆号", [1, 2, 3, 4])).toBe("圆号1,2,3,4.pdf");
    expect(generateFileName("小提琴", [1, 2])).toBe("小提琴1,2.pdf");
    expect(generateFileName("圆号", [1])).toBe("圆号1.pdf");
  });

  it("乐器名首尾空白不进文件名", () => {
    expect(generateFileName("  圆号  ", [1])).toBe("圆号1.pdf");
    expect(generateFileName("  圆号  ", [])).toBe("圆号.pdf");
  });

  it("与 formatSubParts 同源：文件名里的号就是那个规范字符串", () => {
    const parts = [1, 2, 3, 4];
    expect(generateFileName("圆号", parts)).toBe(`圆号${formatSubParts(parts)}.pdf`);
  });
});

describe("sanitizeSubParts：后端响应的收敛", () => {
  it("正常数组原样收敛（升序去重）", () => {
    expect(sanitizeSubParts([1, 2])).toEqual([1, 2]);
    expect(sanitizeSubParts([3, 1])).toEqual([1, 3]);
    expect(sanitizeSubParts([1, 1, 2])).toEqual([1, 2]);
    expect(sanitizeSubParts([])).toEqual([]);
  });

  it("不是数组就当空数组 —— 退化成「没有号」而不是「号是垃圾」", () => {
    // 后端改了字段名时这里会拿到 undefined。⚠️ 原样透传的后果**不是**「文件名里带
    // undefined」（那会直接抛，因为 generateFileName 读 `.length`），真正危险的是
    // 下面那条：元素类型不对时会拼出一个**看着完全正常**的错名字。
    for (const bad of [undefined, null, "1,2", 1, {}, true]) {
      expect(sanitizeSubParts(bad), `${JSON.stringify(bad)}`).toEqual([]);
    }
  });

  it("数组里混了非法元素就整个不要 —— 不做部分接受", () => {
    // 与后端的「任一非空片段非法就整个弃权」同一条哲学：
    // 半个号看起来像对的，会一路写进文件名
    for (const bad of [[1, "2"], [1, 0], [1, -1], [1.5], [1, Infinity], [1, NaN]]) {
      expect(sanitizeSubParts(bad), JSON.stringify(bad)).toEqual([]);
    }
  });

  it("个数上界与常量一致", () => {
    const atLimit = Array.from({ length: MAX_SUB_PARTS }, (_, i) => i + 1);
    expect(sanitizeSubParts(atLimit)).toHaveLength(MAX_SUB_PARTS);
    expect(sanitizeSubParts([...atLimit, MAX_SUB_PARTS + 1])).toEqual([]);
  });
});

describe("overSubPartsCap：把「因上界被丢」这条静默路径变成可见的", () => {
  it("没超上界时不报", () => {
    expect(overSubPartsCap([])).toBeNull();
    expect(overSubPartsCap([1, 2])).toBeNull();
    expect(overSubPartsCap(Array.from({ length: MAX_SUB_PARTS }, (_, i) => i + 1))).toBeNull();
  });

  it("超上界时报出**收到的个数**（消息里要用）", () => {
    const over = Array.from({ length: MAX_SUB_PARTS + 3 }, (_, i) => i + 1);
    expect(overSubPartsCap(over)).toBe(MAX_SUB_PARTS + 3);
  });

  it("元素本身非法时**不报** —— 那不是上界的问题，是另一回事", () => {
    // 若这里也报，用户会看到「超过上界」这种风马牛不相及的提示
    const many = Array.from({ length: MAX_SUB_PARTS + 3 }, () => "x");
    expect(overSubPartsCap(many)).toBeNull();
    expect(
      overSubPartsCap([...Array.from({ length: MAX_SUB_PARTS + 1 }, (_, i) => i + 1), "x"]),
    ).toBeNull();
    // ⚠️ 非整数元素也要覆盖：只测 `"x"`（typeof 不匹配）挡不住
    // `allValid` 漏判 `Number.isSafeInteger` 的实现 —— 那样 `1.5` 会被放行，
    // 于是「33 个 1.5」会报成「超过上界」，提示与原因对不上（审查实测该变异存活）。
    expect(overSubPartsCap(Array.from({ length: MAX_SUB_PARTS + 3 }, () => 1.5))).toBeNull();
    expect(overSubPartsCap(Array.from({ length: MAX_SUB_PARTS + 3 }, () => 2 ** 53))).toBeNull();
  });

  it("上界常量与后端一致（改它必须同时改这里）", () => {
    // ⚠️ 本文件其它用例都从 `MAX_SUB_PARTS` 自己算长度，所以**常量漂移对它们不可见**
    // （变异实测：把 32 改成 8 仍然全绿）。跨仓读取后端文件在 CI 里做不到
    //（前端 checkout 里没有 pkuso-backend），所以这里钉一个字面量 + 指向对端位置，
    // 让「只改一边」这件事**至少在前端变红**。
    // 对端：pkuso-backend/supabase/functions/llm-analyze/analyze.ts 的 MAX_SUB_PARTS
    expect(MAX_SUB_PARTS).toBe(32);
  });

  it("不是数组时不报", () => {
    for (const bad of [undefined, null, "1,2", 3, {}]) {
      expect(overSubPartsCap(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("fillMissingSubParts：段级补号", () => {
  const src = (sourceInstrument: string, sourceSubParts: number[]) => ({
    sourceInstrument,
    sourceSubParts,
  });

  it("漏号的段恰好一个时，把剩下的号补给它", () => {
    // 本 issue 要修的正型：整份 `[1,2]`，第 1 段页眉读出 `[1]`，第 2 段页眉上没印号
    expect(
      fillMissingSubParts({
        ...src("长笛", [1, 2]),
        segments: [
          { instrument: "长笛", subParts: [1] },
          { instrument: "长笛", subParts: [] },
        ],
      }),
    ).toEqual([null, [2]]);
  });

  it("**不同乐器的段不补** —— 它那个空数组是完整答案，不是「没读出来」", () => {
    // 短笛段自己读出 短笛/[]，那是对的（短笛没有分声部号）。补它就把对的改错了。
    expect(
      fillMissingSubParts({
        ...src("长笛", [1, 2]),
        segments: [
          { instrument: "短笛", subParts: [] },
          { instrument: "长笛", subParts: [1] },
          { instrument: "长笛", subParts: [2] },
        ],
      }),
    ).toEqual([null, null, null]);
  });

  it("**漏号不止一段时不补** —— 谁该拿哪个又要靠位置猜，那正是要拆掉的东西", () => {
    expect(
      fillMissingSubParts({
        ...src("圆号", [1, 2, 3, 4]),
        segments: [
          { instrument: "圆号", subParts: [] },
          { instrument: "圆号", subParts: [] },
        ],
      }),
    ).toEqual([null, null]);
  });

  it("减完没剩余就不补", () => {
    expect(
      fillMissingSubParts({
        ...src("长笛", [1, 2]),
        segments: [
          { instrument: "长笛", subParts: [1, 2] },
          { instrument: "长笛", subParts: [] },
        ],
      }),
    ).toEqual([null, null]);
  });

  it("源行的号不足 2 个时不补（减不出东西）", () => {
    for (const s of [[], [1]]) {
      expect(
        fillMissingSubParts({
          ...src("圆号", s),
          segments: [{ instrument: "圆号", subParts: [] }],
        }),
        JSON.stringify(s),
      ).toEqual([null]);
    }
  });

  it("源行乐器为空（没认出来）时谁都不补", () => {
    expect(
      fillMissingSubParts({
        ...src("", [1, 2]),
        segments: [{ instrument: "长笛", subParts: [] }],
      }),
    ).toEqual([null]);
  });

  it("没认出乐器的段既不算「已取走号」也不算「漏号」", () => {
    // 中间那段 instrument 为空 → 它不参与。于是「漏号」只有第 1 段一个，
    // 而第 3 段取走的 [2] 照样算数 → 补 [1] 给第 1 段。
    expect(
      fillMissingSubParts({
        ...src("长笛", [1, 2]),
        segments: [
          { instrument: "长笛", subParts: [] },
          { instrument: "", subParts: [] },
          { instrument: "长笛", subParts: [2] },
        ],
      }),
    ).toEqual([[1], null, null]);
  });

  it("乐器名首尾空白不影响判定", () => {
    expect(
      fillMissingSubParts({
        ...src("长笛", [1, 2]),
        segments: [
          { instrument: " 长笛 ", subParts: [1] },
          { instrument: "长笛", subParts: [] },
        ],
      }),
    ).toEqual([null, [2]]);
  });
});
