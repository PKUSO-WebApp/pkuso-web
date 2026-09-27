import { describe, expect, it } from "vitest";
import { planFileEdit, planScoreEdit } from "./library-edit";
import { MAX_SUB_PARTS } from "./sub-parts";

/**
 * 库编辑的纯判据。这一层**不新写任何判据**（空值/不可见字符/非法字符走 `uploadBlocker`，
 * 号走 `parseSubPartsInput`，文件名走 `generateFileName`），所以这些用例钉的不是「规则是什么」，
 * 而是**「接上了没有」**：判据接错一根线（比如总谱那条放在校验之后、或者自己抄了一份 trim），
 * 界面上就是「上传拦得住、库里改得进去」。
 *
 * ⚠️ 因此几条关键用例**故意断言的是一整句原文**（而不是 `toContain("不能为空")` 之类）：
 * 文案漂了就是「同一个问题在两个入口说法不一样」，用户认不出是同一件事 ——
 * 那正是 `row-text.ts` 的 `unreadMessage` 注释里记着的一次实测事故。
 */

describe("planFileEdit · 正常路径", () => {
  it("号改了，文件名跟着重算（这是「文件名与 sub_parts 不许错位」那条的落点）", () => {
    const r = planFileEdit({ section: "圆号", instrument: "F调圆号", subPartsText: "2,1,1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 去重 + 升序是 `parseSubPartsInput` 的契约，这里连带确认它**真的被调到了**
    expect(r.plan.subParts).toEqual([1, 2]);
    expect(r.plan.fileName).toBe("F调圆号1,2.pdf");
  });

  it("号清空 → 文件名退回没有号的那种（`圆号.pdf`）", () => {
    const r = planFileEdit({ section: "圆号", instrument: "圆号", subPartsText: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.subParts).toEqual([]);
    expect(r.plan.fileName).toBe("圆号.pdf");
  });

  it("全角逗号与顿号照收（中文输入法下的常态，归一化在后端是同一套）", () => {
    const r = planFileEdit({ section: "双簧管", instrument: "双簧管", subPartsText: "1，2、3" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.subParts).toEqual([1, 2, 3]);
    expect(r.plan.fileName).toBe("双簧管1,2,3.pdf");
  });

  it("乐器名与声部名两端的空白被收掉（`generateFileName` 也 trim，但落库的值必须已经是干净的）", () => {
    const r = planFileEdit({ section: " 圆号 ", instrument: " F调圆号 ", subPartsText: " 1 " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.section).toBe("圆号");
    expect(r.plan.instrument).toBe("F调圆号");
    expect(r.plan.fileName).toBe("F调圆号1.pdf");
  });
});

describe("planFileEdit · 总谱", () => {
  it("总谱无视号输入框里的内容：号恒为空、文件名就是「总谱.pdf」", () => {
    const r = planFileEdit({ section: "总谱", instrument: "总谱", subPartsText: "1,2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.subParts).toEqual([]);
    expect(r.plan.fileName).toBe("总谱.pdf");
  });

  it("总谱行上的垃圾号**不拦**（那一格在界面上是禁用的；拦它等于把人锁死在一个改不了的输入上）", () => {
    // 这是「归一化必须排在 `uploadBlocker` 之前」那条的守门用例：
    // 顺序反过来时，`parseSubPartsInput("abc")` 的 invalid 会先冒出来，
    // 用户看着一个禁用的、写着「总谱」的框被要求「请逐个写出（如 1,2,3,4）」
    const r = planFileEdit({ section: "总谱", instrument: "总谱", subPartsText: "abc" });
    expect(r.ok).toBe(true);
  });

  it("乐器名**不**被强制成「总谱」—— 与上传侧同一个口子（那边也是只预填、不锁死）", () => {
    const r = planFileEdit({ section: "总谱", instrument: "圆号", subPartsText: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.instrument).toBe("圆号");
    // 名字不好看是**用户自己填的**，不是我们替他改的；与 `editsOf` 的行为一致
    expect(r.plan.fileName).toBe("圆号.pdf");
  });
});

describe("planFileEdit · 拦截（一句话必须与上传侧逐字相同）", () => {
  it("空乐器名", () => {
    const r = planFileEdit({ section: "圆号", instrument: "", subPartsText: "1" });
    expect(r).toEqual({ ok: false, error: "未识别的乐器名，请先填写再上传" });
  });

  it("只填了零宽空格的乐器名也算空（肉眼看着是空的，落库却是个真名字）", () => {
    const r = planFileEdit({ section: "圆号", instrument: "​", subPartsText: "" });
    expect(r.ok).toBe(false);
  });

  it("空声部名", () => {
    const r = planFileEdit({ section: "", instrument: "圆号", subPartsText: "" });
    expect(r).toEqual({ ok: false, error: "未指定声部，请先填写再上传" });
  });

  it("乐器名里有落不下去的字符 → 报的是**那个原字符**，且字段名说得出是哪一格", () => {
    // 全角冒号：只有折成 NFKC 之后才是非法的，报 raw 才找得到（`unsafe-name.ts` 那条）
    expect(planFileEdit({ section: "圆号", instrument: "圆号：1", subPartsText: "" })).toEqual({
      ok: false,
      error: "乐器名里有不能用于文件名的「：」，请改掉",
    });
  });

  it("声部名里的非法字符单独报（两个字段分开报，用户才知道该改哪一格）", () => {
    expect(planFileEdit({ section: "圆号*", instrument: "圆号", subPartsText: "" })).toEqual({
      ok: false,
      error: "声部名里有不能用于文件名的「*」，请改掉",
    });
  });

  it("区间号：文案与上传侧同一句，且**不展开**（`1-4` 展开成 `1,4` 是个不同的集合）", () => {
    const r = planFileEdit({ section: "圆号", instrument: "圆号", subPartsText: "1-4" });
    expect(r).toEqual({ ok: false, error: "不接受区间「1-4」，请逐个写出（如 1,2,3,4）" });
  });

  it("非数字的号", () => {
    expect(planFileEdit({ section: "圆号", instrument: "圆号", subPartsText: "a" }).ok).toBe(false);
  });

  it("号超过上界", () => {
    // 按常量算而不是写死个数：写死的话，哪天两边把上界调大，这条会从「拦得住」静默变成
    // 「没拦」——用例还是绿的，只是不再测它要测的东西
    const many = Array.from({ length: MAX_SUB_PARTS + 1 }, (_, i) => i + 1).join(",");
    expect(planFileEdit({ section: "圆号", instrument: "圆号", subPartsText: many }).ok).toBe(
      false,
    );
  });
});

describe("planScoreEdit", () => {
  it("三个字段都正常时 trim 后落库", () => {
    const r = planScoreEdit({ title: " 第五交响曲 ", composer: " 肖斯塔科维奇 ", notes: " 备注 " });
    expect(r).toEqual({
      ok: true,
      plan: { title: "第五交响曲", composer: "肖斯塔科维奇", notes: "备注" },
    });
  });

  it("作曲家/备注清空 → **null**，不是空串（与「新增曲子」弹窗逐字一致）", () => {
    const r = planScoreEdit({ title: "第五交响曲", composer: "   ", notes: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.composer).toBeNull();
    expect(r.plan.notes).toBeNull();
  });

  it("曲名空 → 拦", () => {
    expect(planScoreEdit({ title: "  ", composer: "", notes: "" })).toEqual({
      ok: false,
      error: "曲名不能为空",
    });
  });

  it("曲名只填零宽字符 → 也拦（渲染出来是一张没有标题的卡片，事后没人能指着它删）", () => {
    expect(planScoreEdit({ title: "​​", composer: "", notes: "" }).ok).toBe(false);
  });

  it("曲名只填**韩文填充符**（U+3164，肉眼空白但 `isBlankName` 剥不掉）→ 同样拦，且报码位", () => {
    // 这一格是 `isBlankName` 够不着的：U+3164 的类别是 `Lo`，不在它剥的 `Cf`/`Cc` 里。
    // 少了这条判据，一个只填了它、看着空白的曲名会落库成一张没有标题的卡片。
    // 文案走 `unsafeNameMessage`，与上传侧报的是同一句话。
    const r = planScoreEdit({ title: "ㅤ", composer: "", notes: "" });
    expect(r).toEqual({ ok: false, error: "曲名里有看不见的字符（U+3164），请手工重新输入" });
  });

  it("夹在正常文字里的零宽字符**照收**（曲名不进文件名、也没有唯一约束，按文件名那套拦是误伤）", () => {
    const r = planScoreEdit({ title: "肖五​", composer: "", notes: "" });
    expect(r.ok).toBe(true);
  });

  it("曲名里的斜杠/问号**不拦** —— 曲名不是文件名的一部分（`unsafe-name.ts` 守的是另外两处）", () => {
    const r = planScoreEdit({ title: "肖五 / 艾格蒙特", composer: "", notes: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.title).toBe("肖五 / 艾格蒙特");
  });
});
