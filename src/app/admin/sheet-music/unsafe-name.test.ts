import { describe, expect, it } from "vitest";
import { findUnsafeInName, unsafeNameMessage } from "./unsafe-name";

/**
 * ⚠️ **下面两张表与 `pkuso-backend` 的同名测试是同一份**
 * （`supabase/functions/llm-analyze/analyze.test.ts`，搜 `UNSAFE_VECTORS` 定位）。
 * 两仓各有一份实现、之间**没有任何机制能发现漂移**，表是唯一能把「同一件事」钉在两处的
 * 东西 —— 改一边必须改两边，**加向量也要两边一起加**。
 *
 * ⚠️ **表里那些看不见的字符一律写成转义**（`\u00a0` 而不是那个字符本身）：它们在编辑器里
 * 是空白的，写成字面量的话，读的人和 diff 都分不出改的是哪一条（可见的全角字符仍是
 * 字面量 —— 那是内容本身，不是看不见的东西）。
 *
 * 表要同时满足两件事：**每一支都有独有的捕获者**（正则里删掉任何一支，都必须有向量
 * 当场变红），且**每一条都是真会走到的输入**（判据的调用方在判之前会 `.trim()`，所以
 * 空白类字符一律得写成夹在名字中间的样子 —— 两端的那种到不了这里）。
 * （前一条不是凑覆盖率 —— 2026-09-25 后端重写测试时曾只剩 `../etc/passwd` 一条，
 * 于是把 `\p{Cc}|\p{Cf}` 整支删掉也全绿，那是对抗测试实测出来的。）
 */
const UNSAFE_VECTORS: Array<[string, string]> = [
  // —— `\.\.`
  ["..", "两个点"],
  ["../etc/passwd", "路径上跳"],
  ["x/../../y", "藏在中间的 .."],
  ["．.", "NFKC 折叠后才成 ..（全角点 + 半角点）"],
  ["．．", "两个全角点"],
  // —— `\p{Cc}` / `\p{Cf}` / `\p{Cs}`
  ["长笛\u0000", "NUL：整行 insert 会失败，而对象已经传上去了 → 桶里一个孤儿对象"],
  ["a\u001fb", "C0 控制字符"],
  ["长笛\n圆号", "换行"],
  ["长笛\u200b", "零宽空格（Cf）：肉眼同名"],
  ["\ud800", "孤立代理（Cs）：UTF-8 里编不出来，Postgres 收不下"],
  // —— `\p{Default_Ignorable_Code_Point}`：类别是 `Lo`/`Mn`，上面几支**够不着**，
  //    而渲染出来是空白（后端 `BLANK_LETTERS` 认得的几个都落在这一族里）
  ["F调\u3164圆号", "韩文填充符：夹在名字中间，肉眼看不出来"],
  ["\u3164", "整个名字就是它 —— `isBlankName` 也拦不住（它只剥 Cf/Cc）"],
  ["F调\ufe0f圆号", "变体选择符"],
  // —— `\u2800` / `\ufffc`：**属性圈不到、只能点名收**的两个
  ["\u2800", "盲文空格：类别是 `So`，任何属性都圈不到它，只能点名"],
  ["\ufffc", "对象替换符：粘贴带嵌入对象的富文本时会带上它"],
  // —— `\p{Cf}` 里**不在** DICP 的那些（U+0600-0605 / U+FFF9-FFFB / U+13430-1343F…）：
  //    上面那一支接不住它们，删掉 `\p{Cf}` 就会静默漏出这一族
  ["长笛\ufff9", "行间注释锚：只有 `\\p{Cf}` 拦得住"],
  // —— `(?![ ])\p{Zs}`：非空格 Zs 里**除 U+1680 外**只有判 raw 才拦得住（NFKC 都折成普通空格）
  ["F调\u00a0圆号", "NBSP：肉眼与普通空格同形"],
  ["F调\u3000圆号", "全角空格：中文输入法全角模式下很好敲出来"],
  ["F调\u1680圆号", "欧甘空格：Zs 里唯一一个 NFKC 不动它的"],
  // —— `\p{Zl}` / `\p{Zp}`：NFKC 不动它们
  ["F调\u2028圆号", "行分隔符"],
  ["F调\u2029圆号", "段分隔符"],
  // —— Windows 文件名里非法的字符（全角写法折叠后才现形）
  ["Horn\\2", "反斜杠：Windows 上的路径分隔符"],
  ["长笛*", "星号"],
  ["长笛?", "问号"],
  ['长笛"solo"', "双引号"],
  ["长笛<x>", "尖括号"],
  ["长笛|1", "竖线"],
  ["圆号:1", "冒号：NTFS 上会写进备用数据流"],
  ["圆号：1", "全角冒号：NFKC 折成 :"],
  ["圆号＊", "全角星号：NFKC 折成 *"],
];

/**
 * 放行的对照组，与上面的表**同等重要** —— 判据是「拦下」，而拦多了的代价是用户白改一次
 * （看得见、能恢复），拦少了却会落一个**肉眼看不出来**的名字（静默，事后才发现）。
 * 两个方向都得有反例钉着。
 */
const SAFE_VECTORS: Array<[string, string]> = [
  ["圆号", "普通乐器名"],
  ["Bass Clarinet", "普通空格合法（钉住别把 `\\p{Zs}` 整支收进来）"],
  ["木琴/钟琴", "#12 允许的合称（`/` 刻意放行）"],
  ["Ｆ调圆号", "全角字母：NFKC 折成常规形式后合法"],
  ["圆号1,2", "分声部号"],
  ["Oboe 1-2", "连字符"],
  ["圆号.", "结尾的点：值放行（文件名是 `圆号..pdf`，已不在路径段的边界上）"],
];

/** 标题里那些字符要写成码位 —— 不然读的人分不清是哪一条 */
const invisibleInTitle = /[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}\u2800\ufffc]/u;

/** 一个码点写成 `\\u{XXXX}`（表里的转义写法，看得出是哪一个） */
const codePointLabel = (c: string) => `\\u{${c.codePointAt(0)!.toString(16).toUpperCase()}}`;

function show(s: string): string {
  let out = "";
  for (const c of s) out += invisibleInTitle.test(c) && c !== " " ? codePointLabel(c) : c;
  return out;
}

describe("show（用例标题里把不可见字符写成码位，纯粹为了读得出来）", () => {
  it("属性圈得到的那几类和**圈不到点名的**那几个都要转义 —— 否则标题里印出来是空白", () => {
    // 这次栽过：判据只写了 `\p{C}|\p{Z}`，于是 So/Lo/Mn 三类（U+2800/U+3164/U+FE0F）
    // 在标题里原样印成空白 —— 与这个 helper 存在的理由正好相反。
    // Cc/Zs 也一起钉：只测点名那几个的话，判据里的 `\p{C}|\p{Z}` 删掉也不会红
    for (const cp of [0x3164, 0xfe0f, 0x2800, 0xfffc, 0x0007, 0x2007]) {
      expect(show(String.fromCharCode(cp)), "U+" + cp.toString(16).toUpperCase()).toContain("\\u{");
    }
  });
});

describe("findUnsafeInName", () => {
  for (const [raw, why] of UNSAFE_VECTORS) {
    it(`拦下 ${show(raw)} —— ${why}`, () => {
      expect(findUnsafeInName(raw)).not.toBeNull();
    });
  }

  for (const [raw, why] of SAFE_VECTORS) {
    it(`放行 ${show(raw)} —— ${why}`, () => {
      expect(findUnsafeInName(raw)).toBeNull();
    });
  }

  it("两种形态各有一半是对方看不见的 —— 缺哪一半都会漏", () => {
    // 折叠才现形：`．.` 的 raw 形态没有任何一支命中
    expect(findUnsafeInName("．."), "命中的是折叠后的 `..`").toBe("..");
    // raw 才现形：这一条折完就是普通空格，只判折叠的形态会把它放过去
    expect(findUnsafeInName("\u00a0"), "命中的就是它自己").toBe("\u00a0");
  });

  it("返回命中的东西（`..` 是两个字符），不是布尔 —— 文案要拿它说话", () => {
    expect(findUnsafeInName("圆号:1")).toBe(":");
    expect(findUnsafeInName("打击乐/长笛\u200b")).toBe("\u200b");
  });

  it("只有折叠才命中时，报 **raw 里那个字符** —— 报折叠后的形态会点名一个用户手里没有的东西", () => {
    // `圆号：1` 里的全角冒号折完是 `:`。文案给的动作是「改掉」，那就得是他看得见、
    // 删得掉的那个字符；报 `:` 的话他照着找也找不到。
    expect(findUnsafeInName("圆号：1")).toBe("：");
    // 单个省略号折出来是三个点，报 `..` 更是无从猜起
    expect(findUnsafeInName("圆号…")).toBe("…");
    // 只有**连起来折**才成的（`．` + `.`）没有单一原字符可报：退回折叠后的形态。
    // 这一支里用户手里的字符与报出来的是同一类东西（都是点），照着改仍然成立。
    expect(findUnsafeInName("圆号．.")).toBe("..");
  });

  it("每一趟都从头找：上一条的命中不能被上上次调用带过去", () => {
    // 正则没有 `g` 标志 → 没有 lastIndex 状态。若哪天有人给它加上 `g`，这两次调用就会
    // 返回**不同的**东西（第一次 `*`，第二次从 lastIndex 往后找到 `:`）。
    // ⚠️ 输入里必须有两个不同的命中项才看得出来 —— 只写一个 `*` 的话，第二次 exec 失败
    // 会把 lastIndex 归零，于是照样返回 `*`（变异实测：那种写法加 `g` 不变红）。
    expect(findUnsafeInName("长笛*圆号:")).toBe("*");
    expect(findUnsafeInName("长笛*圆号:")).toBe("*");
  });
});

describe("unsafeNameMessage", () => {
  it("看得见的字符直接印出来，并点名字段", () => {
    expect(unsafeNameMessage("乐器名", "*")).toContain("乐器名");
    expect(unsafeNameMessage("乐器名", "*")).toContain("「*」");
    expect(unsafeNameMessage("声部名", "..")).toContain("「..」");
  });

  it("看不见的字符**报码位** —— 印出来的话用户看到的是一句空话，照着找也找不到", () => {
    expect(unsafeNameMessage("乐器名", "\u00a0")).toContain("U+00A0");
    expect(unsafeNameMessage("乐器名", "\u200b")).toContain("U+200B");
    expect(unsafeNameMessage("乐器名", "\ud800")).toContain("U+D800");
    // **点名收的那两个都要钉**：它们靠人记得同步（属性圈不到、没法用类别收），
    // 最容易被漏在「看不见」那一支外面 —— 漏了的话命中它会印出空白字符，与不报码位一样没用
    for (const cp of [0x2800, 0xfffc]) {
      expect(unsafeNameMessage("乐器名", String.fromCharCode(cp))).toContain(
        "U+" + cp.toString(16).toUpperCase().padStart(4, "0"),
      );
    }
  });

  it("看不见的那一类给的动作是「重新输入」而不是「改掉」：看不见就删不掉，多半是粘进来的", () => {
    expect(unsafeNameMessage("乐器名", "\u00a0")).toContain("重新输入");
    expect(unsafeNameMessage("乐器名", "*")).not.toContain("重新输入");
  });

  it("默认不可见的那一族（类别是 `Lo`/`Mn`）同样报码位、同样给「重新输入」", () => {
    const filler = String.fromCharCode(0x3164); // 韩文填充符：渲染出来是空白
    expect(unsafeNameMessage("乐器名", filler)).toContain("U+3164");
    expect(unsafeNameMessage("乐器名", filler)).toContain("重新输入");
  });

  it("判据报什么文案就印什么 —— 只判折叠才命中时报的是 raw 里的字符（`：` 而不是 `:`）", () => {
    // 两层必须同源：文案给的动作是「改掉」，而报一个用户手里没有的字符就等于没给动作。
    expect(unsafeNameMessage("乐器名", findUnsafeInName("圆号：1")!)).toContain("「：」");
    expect(unsafeNameMessage("乐器名", findUnsafeInName("圆号…")!)).toContain("「…」");
  });
});
