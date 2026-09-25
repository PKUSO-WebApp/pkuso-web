import { describe, expect, it } from "vitest";
import { fileTargetsOf, MAX_EXTRA_SECTIONS, normalizeExtraSections } from "./sections";

/**
 * 每条用例对应一个**踩过的或明确要防的坑**，不是凑覆盖率。
 *
 * 这一组钉的是「一份谱落到哪几个声部」的推导 —— 它的后果全在**库里**：
 * 每多一条 target 就多一行 `sheet_music_files`，而文件名与声部名都会写进用户的
 * 下载文件名。所以下面这些边界错一个，表现都是「库里多了/少了看不出错的行」。
 */

describe("normalizeExtraSections", () => {
  it("只留闭集里认得的声部，其余丢弃（不弃权、不报错）", () => {
    expect(normalizeExtraSections("大提琴", ["低音提琴", "巴松管", "随便写的", ""])).toEqual([
      "低音提琴",
    ]);
  });

  it("排除「其他」与「总谱」—— 它们都不是能拿来分组的目的地", () => {
    // 「总谱」压根不在 INSTRUMENT_ORDER 里；「其他」不在列表里但它是**弃权分组**，
    // 两者走的是不同分支，所以一起测。
    expect(normalizeExtraSections("大提琴", ["其他", "总谱", "中提琴"])).toEqual(["中提琴"]);
  });

  it("去掉与主声部重复的：一份谱落到同一个声部两次会插两行同名文件", () => {
    expect(normalizeExtraSections("大提琴", ["大提琴", "低音提琴"])).toEqual(["低音提琴"]);
  });

  it("去重，且上界按**收下的**个数截断", () => {
    expect(normalizeExtraSections("圆号", ["低音提琴", "低音提琴"])).toEqual(["低音提琴"]);
    const many = normalizeExtraSections("圆号", [
      "低音提琴",
      "中提琴",
      "大提琴",
      "长笛",
      "双簧管",
      "单簧管",
    ]);
    expect(many).toHaveLength(MAX_EXTRA_SECTIONS);
    // 截断是**从头截**（保序），不是随机丢
    expect(many).toEqual(["低音提琴", "中提琴", "大提琴"]);
  });

  it("**保序**：顺序决定建 part 与插文件行的先后，不能被排序打乱", () => {
    // 排序（`[...out].sort()`）会按 UTF-16 码元把中文排成「中提琴 → 低音提琴 → 大提琴」，
    // 那是谁都不认得的顺序 —— 而这正是后端 `parseExtraSections` 特意不排序的理由。
    expect(normalizeExtraSections("圆号", ["低音提琴", "大提琴", "中提琴"])).toEqual([
      "低音提琴",
      "大提琴",
      "中提琴",
    ]);
  });

  it("主声部是总谱时恒为空：总谱是「所有声部都在里面」，没有「还落到」这回事", () => {
    expect(normalizeExtraSections("总谱", ["大提琴", "低音提琴"])).toEqual([]);
  });

  it("主声部是「其他」时也恒为空 —— 与后端同一条判据", () => {
    // 「其他」= 认不出主声部；而「还落到 X」的前提是主声部已经定了。
    // 两侧不一致的后果很具体：界面 chip 显示会落到低音提琴、点上传却什么都不落
    // （或反过来），而用户是按界面上看到的去核对的。
    expect(normalizeExtraSections("其他", ["低音提琴"])).toEqual([]);
  });

  it("标量与数组同义（判据不与输入形态相关）", () => {
    // `response_format: json_object` 下模型写成标量完全可达，而语义完全相同 ——
    // 一个放行一个拒绝就是又一处形态相关的判据（与 parseSubParts 那条教训同源）
    expect(normalizeExtraSections("大提琴", "低音提琴")).toEqual(["低音提琴"]);
    expect(normalizeExtraSections("大提琴", ["低音提琴"])).toEqual(["低音提琴"]);
  });

  it("缺字段/怪类型一律当空 —— 必须与「没有额外声部」同义", () => {
    // 这不是「模型答错」，而是「响应里根本没有这个字段」：响应是 `any`
    // （`functions.invoke` 的返回），「字段没来」是这条链路上一等的可能状态。
    // 这个字段**按设计「缺席 ≡ 空」**（见 `upload-modal.types.ts` 的「为什么这些字段都写成可选」），
    // 所以这里归一成 `[]`；别处不能照抄（`evidence` 那条正好相反：缺字段 ≠ 空串）。
    for (const bad of [undefined, null, 1, {}, true, [1, {}, null]]) {
      expect(normalizeExtraSections("大提琴", bad)).toEqual([]);
    }
  });
});

describe("fileTargetsOf", () => {
  it("没有额外声部时就是一条，与加这个功能之前一字不差", () => {
    expect(fileTargetsOf("圆号", [], "F调圆号", [1, 2])).toEqual([
      { section: "圆号", instrument: "F调圆号", fileName: "F调圆号1,2.pdf" },
    ]);
  });

  it("跨声部时一条变两条：主声部用乐器名，额外声部用**声部名**当乐器名", () => {
    // `Violoncello e Basso` 的实际形态：模型只给得出主声部的乐器名，
    // 第二件没有信息可用 —— 而 16 个声部名本身就是标准乐器名，拿它当名字是唯一站得住的选择。
    expect(fileTargetsOf("大提琴", ["低音提琴"], "大提琴", [])).toEqual([
      { section: "大提琴", instrument: "大提琴", fileName: "大提琴.pdf" },
      { section: "低音提琴", instrument: "低音提琴", fileName: "低音提琴.pdf" },
    ]);
  });

  it("**多条 target 共用同一份分声部号** —— 号描述的是那份物理分谱，不是某个声部", () => {
    const targets = fileTargetsOf("大提琴", ["低音提琴"], "大提琴", [1, 2]);
    expect(targets.map((t) => t.fileName)).toEqual(["大提琴1,2.pdf", "低音提琴1,2.pdf"]);
  });

  it("缺省安全：`extraSections` 缺席时只出一条（字段缺席的形态）", () => {
    expect(fileTargetsOf("大提琴", undefined, "大提琴", [])).toHaveLength(1);
  });

  it("主声部为空时返回空数组 —— 调用方**必须**把它当失败报出去", () => {
    // 这里返回 [] 而不是抛，是为了让调用方能给用户一句中文提示；
    // 但调用方若把它当成「没有额外声部、照常上传」，就会变成
    // 「上传成功但库里什么都没有」—— 正是本仓反复记载的那类静默失败。
    expect(fileTargetsOf("", ["低音提琴"], "大提琴", [])).toEqual([]);
    expect(fileTargetsOf("   ", [], "大提琴", [])).toEqual([]);
  });

  it("总谱不因额外声部而多出落点", () => {
    expect(fileTargetsOf("总谱", ["大提琴"], "总谱", [])).toEqual([
      { section: "总谱", instrument: "总谱", fileName: "总谱.pdf" },
    ]);
  });
});
