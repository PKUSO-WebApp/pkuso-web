/**
 * `row-text.ts` 的**直接单测**（拆 god file 第 2 步的收益）。
 *
 * 这些判据以前只能透过 DOM 测（walk 测试驱动真组件），所以每一条都写清「它在防什么」——
 * 注释里的理由与被测代码里的理由**必须对得上**：断言的鉴别力靠的就是这个。
 */
import { describe, expect, it } from "vitest";
import type { UploadFile } from "./upload-modal.types";
import {
  analysisSummary,
  canHaveExtraSections,
  cropNoteOf,
  describeInsertError,
  editsOf,
  isBlankName,
  isFullScoreRow,
  isKnownSection,
  unreadMessage,
  uploadBlocker,
} from "./row-text";

const row = (over: Partial<UploadFile> = {}): UploadFile => ({
  file: new File([], "x.pdf"),
  originalName: "x.pdf",
  status: "pending",
  ...over,
});

describe("editsOf：Edit 优先，用户清空后**不回退**到 Guess", () => {
  it("没编辑过时用 Guess", () => {
    const r = editsOf(
      row({
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        subPartsGuess: [1, 2],
        extraSectionsGuess: ["低音提琴"],
      }),
    );
    expect(r.section).toBe("圆号");
    expect(r.instrument).toBe("F调圆号");
    expect(r.subParts).toEqual([1, 2]);
    expect(r.extraSections).toEqual(["低音提琴"]);
  });

  it("**空串是「用户主动清空」**：Edit 是空串时不能把 Guess 捡回来", () => {
    // 判据用 `!== undefined` 而不是真值判断 —— 用真值判断的话，用户点「清空」之后
    // 会看到旧值自己回来（「清不掉」）。四条 Edit 各有这一条。
    expect(editsOf(row({ sectionEdit: "", sectionGuess: "圆号" })).section).toBe("");
    expect(editsOf(row({ instrumentEdit: "", instrumentGuess: "F调圆号" })).instrument).toBe("");
    expect(editsOf(row({ subPartsEditText: "", subPartsGuess: [1, 2] })).subParts).toEqual([]);
    expect(
      editsOf(row({ extraSectionsEdit: [], extraSectionsGuess: ["低音提琴"] })).extraSections,
    ).toEqual([]);
  });

  it("两侧都 trim（后端/模型给的字符串带空白照样能用）", () => {
    expect(editsOf(row({ sectionGuess: "  圆号  " })).section).toBe("圆号");
    expect(editsOf(row({ instrumentGuess: "  F调圆号 ", sectionGuess: "圆号" })).instrument).toBe(
      "F调圆号",
    );
  });

  it("**总谱没有分声部可言**：号一律当空，且不冒出拦截/上界信号", () => {
    const r = editsOf(
      row({ sectionGuess: "总谱", subPartsGuess: [1, 2], subPartsRaw: "1,2", subPartsOverCap: 3 }),
    );
    expect(r.subParts).toEqual([]);
    expect(r.subPartsUnread).toBeUndefined();
    expect(r.subPartsOverCap).toBeUndefined();
    expect(r.subPartsInvalid).toBeUndefined();
  });

  it("「模型给了号但没读懂」只在**自家号为空**时才算（小提琴那条推导路不能误伤）", () => {
    // 小提琴那类声部会在模型给不出号时由声部推导补出 [1]/[2]，**同时**带着 subPartsRaw。
    // 那种行**有号**，算成「没读懂」就会被拦下 = 误伤。所以条件里有 `guess 为空`。
    expect(editsOf(row({ subPartsGuess: [1], subPartsRaw: "1,2" })).subPartsUnread).toBeUndefined();
    expect(editsOf(row({ subPartsGuess: [], subPartsRaw: "1,2" })).subPartsUnread).toBe("1,2");
  });

  it("用户已经表过态（EditText 有值）就不再报「没读懂」", () => {
    expect(
      editsOf(row({ subPartsEditText: "3", subPartsRaw: "1,2" })).subPartsUnread,
    ).toBeUndefined();
  });
});

describe("uploadBlocker：这一行为什么不能上传", () => {
  it("都填好了 → 空串（可以传）", () => {
    expect(uploadBlocker({ section: "圆号", instrument: "F调圆号" })).toBe("");
  });

  it("空乐器名拦下（后端的「未识别」就是空串）", () => {
    expect(uploadBlocker({ section: "圆号", instrument: "" })).toBe(
      "未识别的乐器名，请先填写再上传",
    );
    expect(uploadBlocker({ section: "圆号", instrument: "   " })).toBe(
      "未识别的乐器名，请先填写再上传",
    );
  });

  it("**只有不可见字符也算空** —— 否则会建出一个肉眼是空、实际叫「\\u200b」的声部与文件", () => {
    // `"​".trim()` 还是它自己（JS 规范行为），所以这里必须走 isBlankName 那条判据。
    // 用纯 ASCII 构造，别在源码里放真字节。
    const zwsp = String.fromCharCode(0x200b);
    expect(uploadBlocker({ section: "圆号", instrument: zwsp })).toBe(
      "未识别的乐器名，请先填写再上传",
    );
    expect(uploadBlocker({ section: zwsp, instrument: "F调圆号" })).toBe(
      "未指定声部，请先填写再上传",
    );
  });

  it("非法字符按字段分别报（用户才知道该改哪一格）", () => {
    // ⚠️ 用 `:`（在 `UNSAFE_IN_NAME` 的集合里），别用 `/` —— 名字进的是数据库列与文件名，
    // 不是路径，所以 `/` **不在**那份判据里（这条最早写错过一次）。
    const bad = "圆号:1";
    expect(uploadBlocker({ section: "圆号", instrument: bad })).toBe(
      "乐器名里有不能用于文件名的「:」，请改掉",
    );
    expect(uploadBlocker({ section: bad, instrument: "F调圆号" })).toBe(
      "声部名里有不能用于文件名的「:」，请改掉",
    );
  });

  it("号非法 / 模型给的号没读懂 → 各自的文案（后者是统一的 unreadMessage）", () => {
    expect(
      uploadBlocker({ section: "圆号", instrument: "F调圆号", subPartsInvalid: "号不合法" }),
    ).toBe("号不合法");
    expect(uploadBlocker({ section: "圆号", instrument: "F调圆号", subPartsUnread: "1-2" })).toBe(
      unreadMessage("1-2"),
    );
  });

  it("拦截顺序：先乐器名，再声部名（两处都空时报的是乐器名）", () => {
    expect(uploadBlocker({ section: "", instrument: "" })).toBe("未识别的乐器名，请先填写再上传");
  });
});

describe("isBlankName", () => {
  it("空白与不可见字符都算空；有可见字符就不算", () => {
    expect(isBlankName("")).toBe(true);
    expect(isBlankName("   ")).toBe(true);
    expect(isBlankName(String.fromCharCode(0x200b))).toBe(true);
    expect(isBlankName(String.fromCharCode(0x200b, 0x200c, 0x20))).toBe(true);
    expect(isBlankName("圆号")).toBe(false);
    expect(isBlankName(" 圆号 ")).toBe(false);
  });

  it("只填韩文填充符（U+3164）**不算空** —— 它由 unsafe-name 那条判据拦下并给出可读的说明", () => {
    // 两套判据刻意不同：这一份只回答「是不是空的」，`unsafe-name.ts` 回答「命中的字符看不看得见」。
    const filler = String.fromCharCode(0x3164);
    expect(isBlankName(filler)).toBe(false);
    expect(uploadBlocker({ section: "圆号", instrument: filler })).toContain("U+3164");
  });
});

describe("isKnownSection / isFullScoreRow / canHaveExtraSections", () => {
  it("闭集里的 16 个声部 + 「其他」 + 「总谱」都算已知", () => {
    expect(isKnownSection("圆号")).toBe(true);
    expect(isKnownSection("其他")).toBe(true);
    expect(isKnownSection("总谱")).toBe(true);
  });

  it("闭集外（含后端别名）不算已知 —— 那是词表漂移的唯一可见信号", () => {
    expect(isKnownSection("巴松管")).toBe(false);
    expect(isKnownSection("")).toBe(false);
  });

  it("总谱判定只走 editsOf（用户清空声部后就不再是总谱）", () => {
    expect(isFullScoreRow(row({ sectionGuess: "总谱" }))).toBe(true);
    expect(isFullScoreRow(row({ sectionEdit: "", sectionGuess: "总谱" }))).toBe(false);
    expect(isFullScoreRow(row({ sectionGuess: "圆号" }))).toBe(false);
  });

  it("能不能有额外声部：总谱与「其他」都不行（与 normalizeExtraSections 同源）", () => {
    expect(canHaveExtraSections(row({ sectionGuess: "圆号" }))).toBe(true);
    expect(canHaveExtraSections(row({ sectionGuess: "总谱" }))).toBe(false);
    expect(canHaveExtraSections(row({ sectionGuess: "其他" }))).toBe(false);
  });
});

describe("文案", () => {
  it("analysisSummary：没识别出乐器时说「需人工确认」，识别出来时带上号", () => {
    expect(analysisSummary("圆号", "", [])).toBe("需人工确认（未识别出乐器）");
    expect(analysisSummary("圆号", "F调圆号", [1, 2])).toBe("识别结果: 圆号 / F调圆号 1,2");
    expect(analysisSummary("圆号", "F调圆号", [])).toBe("识别结果: 圆号 / F调圆号");
  });

  it("unreadMessage 带上模型给的原值（用户才知道该核什么）", () => {
    expect(unreadMessage("1-2")).toContain("1-2");
    expect(unreadMessage("1-2")).toContain("没有号");
  });

  it("cropNoteOf 同时看「决策」与「实际裁没裁出来」—— 只看决策会说反话", () => {
    expect(cropNoteOf({ crop: true, height: 120, staffPct: 0.123 }, true)).toBe(
      "已裁至标题区（谱线在页高 12.3%）",
    );
    expect(cropNoteOf({ crop: true, height: 120, staffPct: 0.123 }, false)).toBe(
      "未裁切（裁切画布创建失败，已改用整页）",
    );
    expect(cropNoteOf({ crop: false, reason: "no-staff" }, false)).toBe("未裁切（未检测到谱线）");
    expect(cropNoteOf({ crop: false, reason: "too-tall", staffPct: 0.5 }, false)).toBe(
      "未裁切（标题区达页高 50.0%，超过 33% 上限）",
    );
    expect(cropNoteOf({ crop: false, reason: "too-thin", height: 40 }, false)).toBe(
      "未裁切（标题区仅 40px，首页直接进音乐）",
    );
  });

  it("describeInsertError：唯一冲突给能照着做的话（名字去重），其余原样透出", () => {
    const targets = [
      { section: "圆号", instrument: "F调圆号", fileName: "F调圆号1.pdf" },
      { section: "圆号", instrument: "F调圆号", fileName: "F调圆号1.pdf" },
    ];
    const msg = describeInsertError({ code: "23505", message: "duplicate key …" }, targets);
    expect(msg).toContain("F调圆号1.pdf");
    expect(msg).not.toContain("F调圆号1.pdf、F调圆号1.pdf"); // 去重过
    expect(describeInsertError({ code: "42P01", message: "relation does not exist" }, [])).toBe(
      "relation does not exist",
    );
  });
});
