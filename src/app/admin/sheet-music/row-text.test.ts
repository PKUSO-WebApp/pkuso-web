/**
 * `row-text.ts` 的**直接单测**（拆 god file 第 2 步的收益）。
 *
 * 这些判据以前只能透过 DOM 测（walk 测试驱动真组件），所以每一条都写清「它在防什么」——
 * 注释里的理由与被测代码里的理由**必须对得上**：断言的鉴别力靠的就是这个。
 */
import { describe, expect, it } from "vitest";
import { INSTRUMENT_ORDER } from "@/constants/instruments";
import type { UploadFile } from "./upload-modal.types";
import {
  analysisSummary,
  canHaveExtraSections,
  cropNoteOf,
  describeInsertError,
  editsOf,
  evidenceLine,
  evidenceWarn,
  hasDetails,
  isBlankName,
  isFullScoreRow,
  isKnownSection,
  isUnidentified,
  needsNoSubPartsButton,
  previewPath,
  sectionWarning,
  segEligible,
  segmentsOf,
  startsOf,
  startTextOf,
  statusColor,
  statusText,
  subPartsNotice,
  unreadMessage,
  unsplitSegments,
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

  it("额外声部在 `editsOf` 里就清洗过（总谱 / 「其他」 → 空；去重、去主声部、保序）", () => {
    expect(
      editsOf(row({ sectionGuess: "总谱", extraSectionsGuess: ["低音提琴"] })).extraSections,
    ).toEqual([]);
    expect(
      editsOf(row({ sectionGuess: "其他", extraSectionsGuess: ["低音提琴"] })).extraSections,
    ).toEqual([]);
    expect(
      editsOf(row({ sectionGuess: "圆号", extraSectionsGuess: ["圆号", "低音提琴", "低音提琴"] }))
        .extraSections,
    ).toEqual(["低音提琴"]);
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

  it("用户点「没有号」（EditText = **空串**）之后必须放行 —— 否则是死胡同", () => {
    // ⚠️ 这是承重的一格：`uploadBlocker` 的注释写着「裸拦会把人锁死在无法通过的状态里」，
    // 界面上那个「本谱没有分声部」按钮把 EditText 置成**空串**（= 用户表态）。
    // 判据必须把「空串」与「没动过（undefined）」分开 —— 用真值判断（`!f.subPartsEditText`）
    // 就把这个逃生口堵死了，而**只喂真值（"3"）的用例在两种写法下都绿**。
    const e = editsOf(
      row({
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        subPartsGuess: [],
        subPartsRaw: "1,2",
        subPartsEditText: "",
      }),
    );
    expect(e.subPartsUnread).toBeUndefined();
    expect(
      uploadBlocker({
        section: e.section,
        instrument: e.instrument,
        subPartsInvalid: e.subPartsInvalid,
        subPartsUnread: e.subPartsUnread,
      }),
    ).toBe("");
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
    // ⚠️ 名字类**内部**的顺序也要钉：两格都非法时要先报乐器名（上面两条各只喂了一格非法，
    // 把两处 `findUnsafeInName` 对调照样绿）。号类判据与名字类的**边界**由本文件上面那条
    // 「名字类判据在号类之前」钉 —— 不是 walk 那两条（它们喂的行名字都合法，钉不到这一族）。
    expect(uploadBlocker({ section: "圆号:1", instrument: "F调圆号:2" })).toContain("乐器名");
  });

  it("非标准声部拦下（与 DB 严格校验同一条判据）", () => {
    expect(uploadBlocker({ section: "小提琴", instrument: "小提琴" })).toBe(
      "声部「小提琴」不在标准列表内，请先选择标准声部",
    );
    expect(uploadBlocker({ section: "木管", instrument: "长笛" })).toBe(
      "声部「木管」不在标准列表内，请先选择标准声部",
    );
  });

  it("总谱 / 其他 仍可上传（它们是 section 的合法特殊值）", () => {
    expect(uploadBlocker({ section: "总谱", instrument: "总谱" })).toBe("");
    expect(uploadBlocker({ section: "其他", instrument: "其他" })).toBe("");
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

  it("拦截顺序：**名字类判据在号类之前**（名字空 + 号非法时，要报「请先填写」）", () => {
    // 只钉 instrument→section 那一对是不够的：把号类判据整体提到名字类之前，用户会先看到
    // 「号不合法」，而真正卡住他的是名字还没填。
    expect(uploadBlocker({ section: "", instrument: "", subPartsInvalid: "号不合法" })).toBe(
      "未识别的乐器名，请先填写再上传",
    );
    expect(uploadBlocker({ section: "圆号", instrument: "", subPartsUnread: "1,2" })).toBe(
      "未识别的乐器名，请先填写再上传",
    );
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

  it("**控制字符**（`\\p{Cc}`）也算空 —— `.trim()` 同样不管它们", () => {
    // 覆盖缺口：只测零宽（`\p{Cf}`）的话，把 `INVISIBLE` 里的 `\p{Cc}` 去掉一个用例都不会红。
    expect(isBlankName(String.fromCharCode(0x07))).toBe(true); // BEL
    expect(isBlankName(String.fromCharCode(0x00))).toBe(true); // NUL
    expect(isBlankName(` ${String.fromCharCode(0x07)} `)).toBe(true);
  });

  it("只填韩文填充符（U+3164）**不算空** —— 它由 unsafe-name 那条判据拦下并给出可读的说明", () => {
    // 两套判据刻意不同：这一份只回答「是不是空的」，`unsafe-name.ts` 回答「命中的字符看不看得见」。
    const filler = String.fromCharCode(0x3164);
    expect(isBlankName(filler)).toBe(false);
    expect(uploadBlocker({ section: "圆号", instrument: filler })).toContain("U+3164");
  });
});

describe("isKnownSection / isFullScoreRow / canHaveExtraSections", () => {
  it("声部表里的**每一个** + 「其他」 + 「总谱」都算已知（遍历，不写死个数）", () => {
    // 原来只验了「圆号」，名字里却写着个数 —— 声部表加一项，名字与断言就各错各的。
    for (const s of INSTRUMENT_ORDER) expect(isKnownSection(s)).toBe(true);
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
    // 与 canHaveExtraSections 是同一条：抄一份**不带 trim** 的推导式时，模型给的「 总谱 」
    // 会被判成非总谱 → 那一行**会进分段**（docblock 自己写着这个后果）。
    expect(isFullScoreRow(row({ sectionGuess: " 总谱 " }))).toBe(true);
  });

  it("能不能有额外声部：总谱与「其他」都不行（与 normalizeExtraSections 同源）", () => {
    expect(canHaveExtraSections(row({ sectionGuess: "圆号" }))).toBe(true);
    expect(canHaveExtraSections(row({ sectionGuess: "总谱" }))).toBe(false);
    expect(canHaveExtraSections(row({ sectionGuess: "其他" }))).toBe(false);
    // 取值必须走 editsOf（那里两侧 trim）—— 抄一份不带 trim 的推导式时，模型给的
    // `" 总谱 "` 会被判成「可以有额外声部」，用户加完被清洗静默丢掉（该函数 docblock 的警告）。
    expect(canHaveExtraSections(row({ sectionGuess: " 总谱 " }))).toBe(false);
  });
});

describe("文案", () => {
  it("analysisSummary：没识别出乐器时说「需人工确认」，识别出来时带上号", () => {
    expect(analysisSummary("圆号", "", [])).toBe("需人工确认（未识别出乐器）");
    expect(analysisSummary("圆号", "F调圆号", [1, 2])).toBe("识别结果: 圆号 / F调圆号 1,2");
    expect(analysisSummary("圆号", "F调圆号", [])).toBe("识别结果: 圆号 / F调圆号");
  });

  it("unreadMessage 整句钉住（`toContain` 钉不住：换一句别的话照样能含这两个子串）", () => {
    // 这条文案是 `uploadBlocker` 与 `subPartsNotice` 共用的，改写的后果是去重守卫匹配不上、
    // 用户会看到黄红两行 —— 但「改写成另一句」在 `toContain` 下是绿的，所以整句比。
    expect(unreadMessage("1-2")).toBe(
      "识别到分声部号但没读懂（模型给的是「1-2」）：请填上号，或点「没有号」",
    );
  });

  it("cropNoteOf 同时看「决策」与「实际裁没裁出来」—— 只看决策会说反话", () => {
    expect(cropNoteOf({ crop: true, height: 120, staffPct: 0.123 }, true)).toBe(
      "已裁至标题区（谱线在页高 12.3%）",
    );
    expect(cropNoteOf({ crop: true, height: 120, staffPct: 0.123 }, false)).toBe(
      "未裁切（裁切画布创建失败，已改用整页）",
    );
    expect(cropNoteOf({ crop: false, reason: "no-staff" }, false)).toBe("未裁切（未检测到谱线）");
    // 上限 33% 是**字面量**断言：文案由 `MAX_CROP_PCT` 算出（不再抄一份字面量），
    // 把常量改成别的值，这一句就红。
    expect(cropNoteOf({ crop: false, reason: "too-tall", staffPct: 0.5 }, false)).toBe(
      "未裁切（标题区达页高 50.0%，超过 33% 上限）",
    );
    expect(cropNoteOf({ crop: false, reason: "too-thin", height: 40 }, false)).toBe(
      "未裁切（标题区仅 40px，首页直接进音乐）",
    );
  });

  it("推算补上的号有可见标记；自己读出的号与用户填过的号都不标", () => {
    // 补号与识别结果在界面上长得一样 —— 不标出来用户会当成识别结果。
    expect(subPartsNotice(row({ subPartsGuess: [2], subPartsAutoFilled: true }))).toBe(
      "分声部号是按其它段推算补上的（这一段没读出号）—— 请核对",
    );
    // 正向同伴：同一字段为 false 时不出现，证明那句是标记驱动的、不是恒显。
    expect(subPartsNotice(row({ subPartsGuess: [2], subPartsAutoFilled: false }))).toBe("");
    // 用户已经填过号：让位（否则用户改完还挂着「请核对」）。
    expect(
      subPartsNotice(row({ subPartsGuess: [2], subPartsAutoFilled: true, subPartsEditText: "2" })),
    ).toBe("");
  });

  it("describeInsertError：唯一冲突给能照着做的话（名字去重），其余原样透出", () => {
    const targets = [
      { section: "圆号", instrument: "F调圆号", fileName: "F调圆号1.pdf" },
      { section: "圆号", instrument: "F调圆号", fileName: "F调圆号1.pdf" },
    ];
    expect(describeInsertError({ code: "23505", message: "duplicate key …" }, targets)).toBe(
      "这一声部下已经有同名文件（F调圆号1.pdf）—— 请改乐器名或分声部号，或先删掉详情页里那份",
    );
    // `21000` 是同一个约束的另一副面孔（`INSERT … ON CONFLICT DO UPDATE` 里两个相同的键），
    // 走同一句话 —— 只钉 `23505` 的话，把这个分支整段删掉不会有任何用例变红。
    expect(
      describeInsertError({ code: "21000", message: "cannot affect row a second time" }, targets),
    ).toBe("这一声部下已经有同名文件（F调圆号1.pdf）—— 请改乐器名或分声部号，或先删掉详情页里那份");
    expect(describeInsertError({ code: "42P01", message: "relation does not exist" }, [])).toBe(
      "relation does not exist",
    );
  });

  it("describeInsertError：**多个落点各有各的名字**时，去重不误伤、分隔符写对", () => {
    // ⚠️ 上面那条 fixture 的两个名字**完全相同**，去重后只剩一个 —— 于是 `join` 的分隔符
    // 根本不产生，把 `、` 改成 `,` 也照样绿。真实场景恰恰是两个不同的名字
    // （`fileTargetsOf` 按主声部 + 额外声部产出，同一份谱落两个声部）。
    const targets = [
      { section: "圆号", instrument: "F调圆号", fileName: "F调圆号1.pdf" },
      { section: "低音提琴", instrument: "低音提琴", fileName: "低音提琴1.pdf" },
    ];
    expect(describeInsertError({ code: "23505", message: "dup" }, targets)).toBe(
      "这一声部下已经有同名文件（F调圆号1.pdf、低音提琴1.pdf）—— 请改乐器名或分声部号，或先删掉详情页里那份",
    );
  });
});

describe("hasDetails：展开键认哪些字段（#326 第 1 条）", () => {
  it("只有弃权原因也算「有详情」—— 面板里渲染着它", () => {
    // ⚠️ **这个行状态在今天的链路里到不了**：写 `abstainReason` 的每条路（`analyzeOne`
    // 的成功回写、`retryRow`、段级识别的两个分支）都**同时**写了 `llmResult` 或
    // `warning`，旧判据本来就为真 —— 所以这条**不是一次复现**（议题正文里那句后果的说法
    // 不成立，写点穷举见 `row-text.ts` 里 `hasDetails` 的 docblock）。
    //
    // 钉的是**判据与面板的契约**：`components/details-panel.tsx` 会渲染这条原因，
    // 而 `hasDetails` 是那个展开键的开关 —— 两者必须认同一组字段，否则下一个
    // 「只写 abstainReason、不再顺带写 llmResult」的写者就会做出一个**有内容却打不开**的行。
    expect(hasDetails(row({ abstainReason: "empty-instrument" }))).toBeTruthy();
    // 对照组：一个详情字段都没有 → 不给展开键（点了只会开出空面板）
    expect(hasDetails(row())).toBeFalsy();
  });
});

/* ------------------------------------------------------------------ *
 * 行卡片 helper（#409 第 1 项）
 *
 * 这一批以前只靠 walk 测试透过 DOM 间接覆盖 —— 于是「某个守卫被删掉」通常不会变红，
 * 只会让某个页面片段悄悄多出来或少掉。每条用例的名字都写的是**它在防的那件事**，
 * 表里每一格对应 `row-text.ts` 里一个真实分支（含 undefined / "" / 0 / 1 的边界）。
 * ------------------------------------------------------------------ */

describe("needsNoSubPartsButton：「没有号」逃生口的唯一判据", () => {
  const cases: Array<{ name: string; over: Partial<UploadFile>; expected: boolean }> = [
    {
      name: "模型给了号但没读懂（guess 为空 + 有 Raw + 用户没动过）→ 显示",
      over: { sectionGuess: "圆号", subPartsGuess: [], subPartsRaw: "1,2" },
      expected: true,
    },
    {
      // 小提琴那类声部会在模型给不出号时用声部推导补出 [1]/[2]，**同时**带着 subPartsRaw。
      // 那种行有号，显示按钮 = 误伤；判据必须与 `editsOf().subPartsUnread` 同源。
      name: "号已由声部推导补出（guess 非空）→ 不显示（不能误伤）",
      over: { sectionGuess: "圆号", subPartsGuess: [1, 2], subPartsRaw: "1,2" },
      expected: false,
    },
    {
      // 用户已经表态（填了号）之后那句「没读懂」会一直挂着 -> 变成消不掉的假告警。
      name: "用户已经填过号（EditText 有值）→ 不显示",
      over: { sectionGuess: "圆号", subPartsGuess: [], subPartsRaw: "1,2", subPartsEditText: "3" },
      expected: false,
    },
    {
      // 点「没有号」把 EditText 置成**空串**（= 用户表态）。用真值判断会把这个
      // 逃生口堵死 —— 空串必须与「没动过（undefined）」分开。
      name: "用户点过「没有号」（EditText = 空串）→ 不显示（逃生口不能堵死）",
      over: { sectionGuess: "圆号", subPartsGuess: [], subPartsRaw: "1,2", subPartsEditText: "" },
      expected: false,
    },
    {
      // 总谱本就没有「第几号」可言；段行「重试」回总谱时 subPartsRaw 会原样留着，
      // 这个组合可达。收走 file-row 里那份少了 `!isFullScore` 的拷贝是有意的行为改变。
      name: "总谱行（即使带着上次留下的 Raw）→ 不显示",
      over: { sectionGuess: "总谱", subPartsGuess: [], subPartsRaw: "1,2" },
      expected: false,
    },
    {
      name: "没有 Raw（模型没给过号）→ 不显示",
      over: { sectionGuess: "圆号", subPartsGuess: [] },
      expected: false,
    },
    {
      name: "Raw 是空串（不是「没读懂」而是「没给」）→ 不显示",
      over: { sectionGuess: "圆号", subPartsGuess: [], subPartsRaw: "" },
      expected: false,
    },
  ];
  for (const c of cases) {
    it(c.name, () => expect(needsNoSubPartsButton(row(c.over))).toBe(c.expected));
  }
});

describe("isUnidentified：分析完了但没认出乐器", () => {
  const cases: Array<{ name: string; over: Partial<UploadFile>; expected: boolean }> = [
    {
      name: "analyzed + 没有乐器 → 未识别",
      over: { status: "analyzed" },
      expected: true,
    },
    {
      // 后端「未识别」给的就是空串；只有空白同样不该被当成识别成功
      //（`editsOf` 两侧 trim，所以判断必须走它而不是原始字段）。
      name: "analyzed + 乐器只有空白 → 未识别",
      over: { status: "analyzed", instrumentGuess: "   " },
      expected: true,
    },
    {
      name: "analyzed + 用户把乐器清空（Edit 空串压过 Guess）→ 未识别",
      over: { status: "analyzed", instrumentGuess: "F调圆号", instrumentEdit: "" },
      expected: true,
    },
    {
      name: "analyzed + 有乐器 → 已识别",
      over: { status: "analyzed", instrumentGuess: "F调圆号" },
      expected: false,
    },
    {
      name: "analyzed + 用户手填了乐器 → 已识别",
      over: { status: "analyzed", instrumentEdit: "F调圆号" },
      expected: false,
    },
    // 它判的是「分析完了**但**没认出」，不是单纯的「没乐器」—— 其余状态各有各的文案，
    // 掉进「未识别」会让状态行说错话（例如失败行被报成需人工确认）。
    { name: "pending + 没乐器 → 不是「未识别」", over: { status: "pending" }, expected: false },
    { name: "analyzing + 没乐器 → 不是", over: { status: "analyzing" }, expected: false },
    { name: "uploading + 没乐器 → 不是", over: { status: "uploading" }, expected: false },
    { name: "done + 没乐器 → 不是", over: { status: "done" }, expected: false },
    { name: "error + 没乐器 → 不是", over: { status: "error" }, expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => expect(isUnidentified(row(c.over))).toBe(c.expected));
  }
});

describe("segEligible：这份文件要不要跑分段（多页、非总谱）", () => {
  const splitOf = { groupId: "g1", from: 1, to: 2, segIndex: 0, segTotal: 2 };
  const cases: Array<{ name: string; over: Partial<UploadFile>; expected: boolean }> = [
    {
      name: "多页 + 非总谱 + 已识别 → 跑",
      over: { status: "analyzed", sectionGuess: "圆号", instrumentGuess: "F调圆号", pageCount: 3 },
      expected: true,
    },
    {
      // 单页没有边界可言，跑它是白烧一次 OCR。
      name: "单页 → 不跑",
      over: { status: "analyzed", sectionGuess: "圆号", instrumentGuess: "F调圆号", pageCount: 1 },
      expected: false,
    },
    {
      name: "页数 0（非法）→ 不跑",
      over: { status: "analyzed", sectionGuess: "圆号", instrumentGuess: "F调圆号", pageCount: 0 },
      expected: false,
    },
    {
      // 页数未知（例如分析失败）时连成本都算不出来 —— 不能被当成多页。
      name: "页数未知 → 不跑",
      over: { status: "analyzed", sectionGuess: "圆号", instrumentGuess: "F调圆号" },
      expected: false,
    },
    {
      // 用户定「总谱不参与切分检测」，省掉最大的一笔 OCR。
      name: "总谱 → 不跑",
      over: { status: "analyzed", sectionGuess: "总谱", instrumentGuess: "总谱", pageCount: 3 },
      expected: false,
    },
    {
      // 总谱判据只走 isFullScoreRow（那里 trim）。抄一份不带 trim 的会把它当成普通多页行。
      name: "总谱（模型给的是「 总谱 」带空白）→ 不跑",
      over: { status: "analyzed", sectionGuess: " 总谱 ", instrumentGuess: "总谱", pageCount: 3 },
      expected: false,
    },
    {
      // 分析成功 + 上传失败的行**带 pageCount**，是可达的一条：少了这条守卫，
      // 它会被算进分段池、按钮按它计费。
      name: "status=error（带 pageCount）→ 不跑",
      over: { status: "error", sectionGuess: "圆号", instrumentGuess: "F调圆号", pageCount: 3 },
      expected: false,
    },
    {
      // 已上传成功的行不再渲染编辑器块，跑分段 = 份数与真实调用都白烧。
      name: "status=done → 不跑",
      over: { status: "done", sectionGuess: "圆号", instrumentGuess: "F调圆号", pageCount: 3 },
      expected: false,
    },
    {
      // 未识别的行「是什么」都还没定，分段是按页烧 OCR 的最贵那条路。
      name: "analyzed 但未识别 → 不跑",
      over: { status: "analyzed", sectionGuess: "圆号", pageCount: 3 },
      expected: false,
    },
    {
      // 段是产物不是源，对一段再跑分段没有意义。
      name: "已经是切出来的一段（splitOf）→ 不跑",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        pageCount: 3,
        splitOf,
      },
      expected: false,
    },
  ];
  for (const c of cases) {
    it(c.name, () => expect(segEligible(row(c.over))).toBe(c.expected));
  }
});

describe("segmentsOf / startsOf / startTextOf：界面上编辑的那组起点", () => {
  const segCases: Array<{
    name: string;
    over: Partial<UploadFile>;
    expected: Array<{ from: number; to: number }>;
  }> = [
    {
      name: "没跑过分段（起点/页数都缺省）→ 整份一段 [{1,1}]",
      over: {},
      expected: [{ from: 1, to: 1 }],
    },
    {
      name: "用户改过起点 → 按改过的起点推出闭区间",
      over: { segmentStarts: [1, 5], pageCount: 8 },
      expected: [
        { from: 1, to: 4 },
        { from: 5, to: 8 },
      ],
    },
    {
      name: "起点乱序 + 重复 → 先收敛再算（不能把重复当成两段）",
      over: { segmentStarts: [5, 1, 5], pageCount: 8 },
      expected: [
        { from: 1, to: 4 },
        { from: 5, to: 8 },
      ],
    },
    {
      // normalizeSegments 的语义是 filter：越界起点被丢掉 = 那一段并进上一段。
      // 直接拿原始 starts 数长度会多算一段（就是下面 unsplitSegments 要防的死胡同）。
      name: "越界的起点被丢掉 → 只剩一段",
      over: { segmentStarts: [1, 9], pageCount: 8 },
      expected: [{ from: 1, to: 8 }],
    },
    {
      // 页数未知按 1 页兜底；若 `?? 0` 会得到 []，界面上一段都没有。
      name: "页数未知时按 1 页算（不产出 {from:1,to:0}）",
      over: { segmentStarts: [1, 3] },
      expected: [{ from: 1, to: 1 }],
    },
    {
      name: "页数为 0（非法）→ 没有段",
      over: { segmentStarts: [1], pageCount: 0 },
      expected: [],
    },
    {
      // 空数组不是 undefined：`??` 保留它，恒含第 1 页的规则由 normalizeSegments 给。
      name: "起点是空数组 → 仍恒含第 1 页",
      over: { segmentStarts: [], pageCount: 5 },
      expected: [{ from: 1, to: 5 }],
    },
  ];
  for (const c of segCases) {
    it(`segmentsOf：${c.name}`, () => expect(segmentsOf(row(c.over))).toEqual(c.expected));
  }

  const startsCases: Array<{ name: string; over: Partial<UploadFile>; expected: number[] }> = [
    { name: "缺省 → [1]", over: {}, expected: [1] },
    { name: "有起点 → 原样返回", over: { segmentStarts: [1, 4] }, expected: [1, 4] },
    {
      // 兜底只针对 undefined。空数组是**用户/状态明确给出的值** —— 写成
      // `segmentStarts?.length ? segmentStarts : [1]` 那种按长度的兜底会把它
      // 悄悄换成 [1]（界面上就凭空多出一段）。
      name: "空数组不是 undefined → 原样返回 []",
      over: { segmentStarts: [] },
      expected: [],
    },
  ];
  for (const c of startsCases) {
    it(`startsOf：${c.name}`, () => expect(startsOf(row(c.over))).toEqual(c.expected));
  }

  const textCases: Array<{ name: string; over: Partial<UploadFile>; expected: string[] }> = [
    {
      name: "没存过原文 → 按起点回填（与 segmentStarts 逐位对应）",
      over: { segmentStarts: [1, 4] },
      expected: ["1", "4"],
    },
    {
      name: '起点也缺省 → ["1"]',
      over: {},
      expected: ["1"],
    },
    {
      // 存原文而不是解析结果是受控输入的硬要求：中间态只停在框里。
      name: "存过原文 → 原样返回（不能用起点回填覆盖它）",
      over: { segmentStarts: [1, 4], segmentStartText: ["1", "5"] },
      expected: ["1", "5"],
    },
    {
      name: "原文是空数组 → 原样返回 []（有 key 就不再按起点回填）",
      over: { segmentStarts: [1, 4], segmentStartText: [] },
      expected: [],
    },
    {
      name: "原文与起点不等长 → 不回填、不裁剪（逐位对应由调用方维持）",
      over: { segmentStarts: [1, 4], segmentStartText: ["1"] },
      expected: ["1"],
    },
  ];
  for (const c of textCases) {
    it(`startTextOf：${c.name}`, () => expect(startTextOf(row(c.over))).toEqual(c.expected));
  }
});

describe("unsplitSegments：「确认这 N 段」按钮与上传拦截的同一条判据", () => {
  const splitOf = { groupId: "g1", from: 1, to: 2, segIndex: 0, segTotal: 2 };
  const cases: Array<{ name: string; over: Partial<UploadFile>; expected: boolean }> = [
    {
      name: "可分段 + 识别出多段 + 还没拆 → 要拦（也是按钮的显示条件）",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        pageCount: 5,
        segmentStarts: [1, 3],
      },
      expected: true,
    },
    {
      name: "只有一段 → 不拦",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        pageCount: 5,
        segmentStarts: [1],
      },
      expected: false,
    },
    {
      name: "没跑过分段（起点缺省）→ 不拦",
      over: { status: "analyzed", sectionGuess: "圆号", instrumentGuess: "F调圆号", pageCount: 5 },
      expected: false,
    },
    {
      // 这是「跑完分段后把声部改成总谱」那条实测过的死胡同：分段块整块不渲染
      //（segEligible 为假），拦截若还在，文案就会指着屏幕上不存在的按钮。
      name: "总谱（segEligible 为假）→ 即使起点有多段也不拦",
      over: {
        status: "analyzed",
        sectionGuess: "总谱",
        instrumentGuess: "总谱",
        pageCount: 5,
        segmentStarts: [1, 3],
      },
      expected: false,
    },
    {
      name: "status=error（不可分段）→ 即使起点有多段也不拦",
      over: {
        status: "error",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        pageCount: 5,
        segmentStarts: [1, 3],
      },
      expected: false,
    },
    {
      // 起点数组里有非法值，但 segmentsOf（filter）收敛后只剩一段 —— 不能按
      // 原始数组长度算，否则会拦下一个「其实没有多段」的行。
      name: "起点收敛后只剩一段（越界值被 filter）→ 不拦",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        pageCount: 5,
        segmentStarts: [1, 9],
      },
      expected: false,
    },
    {
      name: "已经是切出来的一段（splitOf）→ 不拦",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        pageCount: 5,
        segmentStarts: [1, 3],
        splitOf,
      },
      expected: false,
    },
    {
      // 单页文件即使带着两个起点，segmentsOf 也只给一段。
      name: "单页（pageCount=1）→ 不拦",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        pageCount: 1,
        segmentStarts: [1, 3],
      },
      expected: false,
    },
  ];
  for (const c of cases) {
    it(c.name, () => expect(unsplitSegments(row(c.over))).toBe(c.expected));
  }
});

describe("previewPath：预览「这将存成什么名字」", () => {
  const cases: Array<{ name: string; over: Partial<UploadFile>; expected: string }> = [
    {
      name: "识别出主声部与乐器 → `声部 / 文件名`",
      over: { sectionGuess: "圆号", instrumentGuess: "F调圆号" },
      expected: "圆号 / F调圆号.pdf",
    },
    {
      name: "有分声部号 → 号进文件名",
      over: { sectionGuess: "圆号", instrumentGuess: "F调圆号", subPartsGuess: [1, 2] },
      expected: "圆号 / F调圆号1,2.pdf",
    },
    {
      // 跨声部时要把落点全列出来 —— 只显示主声部的话，用户看到的预览与落库结果对不上。
      name: "跨声部 → 每个落点各占一段，顺序保持",
      over: {
        sectionGuess: "大提琴",
        instrumentGuess: "大提琴",
        subPartsGuess: [1],
        extraSectionsGuess: ["低音提琴"],
      },
      expected: "大提琴 / 大提琴1.pdf、低音提琴 / 低音提琴1.pdf",
    },
    {
      // 总谱的额外声部会被清洗掉（normalizeExtraSections 与 fileTargetsOf 同源）。
      name: "总谱 → 额外声部被清洗，只剩一个落点",
      over: { sectionGuess: "总谱", instrumentGuess: "总谱", extraSectionsGuess: ["低音提琴"] },
      expected: "总谱 / 总谱.pdf",
    },
    {
      // 有硬伤时宁可显示「待确认」，也别让用户以为存的就是那个看着正常的名字。
      name: "号非法 → 显示待确认，不显示一个看着正常的名字",
      over: { sectionGuess: "圆号", instrumentGuess: "F调圆号", subPartsEditText: "1-2" },
      expected: "圆号 / （分声部号待确认）",
    },
    {
      name: "模型给了号但没读懂 → 同样显示待确认",
      over: {
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        subPartsGuess: [],
        subPartsRaw: "1,2",
      },
      expected: "圆号 / （分声部号待确认）",
    },
    {
      // 乐器名判据排在硬伤判据之前：没有乐器时连「待确认」的名字都不该出现
      //（这一行 uploadBlocker 会先拦下）。
      name: "乐器名为空 + 号非法 → 空串（不拼出半个名字）",
      over: { sectionGuess: "圆号", instrumentGuess: "", subPartsEditText: "1-2" },
      expected: "",
    },
    {
      name: "乐器名只有空白（trim 后为空）→ 空串",
      over: { sectionGuess: "圆号", instrumentGuess: "   " },
      expected: "",
    },
    {
      name: "用户把乐器清空（空串压过 Guess）→ 空串",
      over: { sectionGuess: "圆号", instrumentGuess: "F调圆号", instrumentEdit: "" },
      expected: "",
    },
    {
      // 没有主声部就没有落点（fileTargetsOf 返回 []）；预览不能凭空编一个。
      name: "声部为空 → 空串（没有落点可预览）",
      over: { instrumentGuess: "F调圆号" },
      expected: "",
    },
  ];
  for (const c of cases) {
    it(c.name, () => expect(previewPath(row(c.over))).toBe(c.expected));
  }
});

describe("statusText / statusColor：行标题与状态色各自认哪些分支", () => {
  const textCases: Array<{ name: string; over: Partial<UploadFile>; expected: string }> = [
    { name: "pending → 待分析", over: { status: "pending" }, expected: "待分析" },
    { name: "analyzing → 分析中...", over: { status: "analyzing" }, expected: "分析中..." },
    { name: "uploading → 上传中...", over: { status: "uploading" }, expected: "上传中..." },
    {
      name: "error → `失败: <原因>`（失败原因不能被藏起来）",
      over: { status: "error", error: "网络错误" },
      expected: "失败: 网络错误",
    },
    {
      name: "analyzed + 乐器 → 已识别（带号）",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        subPartsGuess: [1, 2],
      },
      expected: "已识别 → 圆号 / F调圆号 1,2",
    },
    {
      // 跨声部时标题也要写落点，否则同一张卡片里它与 previewPath 互相矛盾。
      name: "analyzed + 额外声部 → 标题里写出「并另存到」",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        extraSectionsGuess: ["低音提琴", "中提琴"],
      },
      expected: "已识别 → 圆号 / F调圆号（并另存到 低音提琴、中提琴）",
    },
    {
      name: "analyzed + 号与额外声部 → 两段后缀都有",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        subPartsGuess: [1],
        extraSectionsGuess: ["低音提琴"],
      },
      expected: "已识别 → 圆号 / F调圆号 1（并另存到 低音提琴）",
    },
    {
      // 空乐器名 = 模型自己说不知道；不能显示成识别成功。
      name: "analyzed + 没有乐器 → 需人工确认",
      over: { status: "analyzed", sectionGuess: "圆号" },
      expected: "需人工确认",
    },
    {
      name: "analyzed + 乐器只有空白 → 需人工确认（不能显示成已识别）",
      over: { status: "analyzed", sectionGuess: "圆号", instrumentGuess: "   " },
      expected: "需人工确认",
    },
    {
      // 取值只走 editsOf：清空后回退到 Guess 会让用户以为「清不掉」。
      name: "analyzed + 用户清空乐器（空串压过 Guess）→ 需人工确认",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        instrumentEdit: "",
      },
      expected: "需人工确认",
    },
    {
      name: "done + 乐器 → 已上传（带号与额外声部）",
      over: {
        status: "done",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        subPartsGuess: [1],
        extraSectionsGuess: ["低音提琴"],
      },
      expected: "已上传 → 圆号 / F调圆号 1（并另存到 低音提琴）",
    },
    {
      name: "done + 没有乐器 → 只写「已上传」",
      over: { status: "done", sectionGuess: "圆号" },
      expected: "已上传",
    },
    {
      name: "done + 用户清空乐器 → 只写「已上传」",
      over: {
        status: "done",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        instrumentEdit: "",
      },
      expected: "已上传",
    },
  ];
  for (const c of textCases) {
    it(`statusText：${c.name}`, () => expect(statusText(row(c.over))).toBe(c.expected));
  }

  const colorCases: Array<{ name: string; over: Partial<UploadFile>; expected: string }> = [
    {
      // 未识别行**不能是绿的**：一行「需人工确认」配上 success 色，用户扫一眼会以为没事。
      name: "analyzed 但未识别 → text-warning（覆盖 analyzed 的 success）",
      over: { status: "analyzed", sectionGuess: "圆号" },
      expected: "text-warning",
    },
    {
      name: "analyzed + 乐器只有空白 → text-warning",
      over: { status: "analyzed", sectionGuess: "圆号", instrumentGuess: "   " },
      expected: "text-warning",
    },
    {
      name: "analyzed + 用户清空乐器 → text-warning",
      over: {
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "F调圆号",
        instrumentEdit: "",
      },
      expected: "text-warning",
    },
    { name: "pending → text-text-muted", over: { status: "pending" }, expected: "text-text-muted" },
    { name: "analyzing → text-primary", over: { status: "analyzing" }, expected: "text-primary" },
    {
      name: "analyzed + 已识别 → text-success",
      over: { status: "analyzed", sectionGuess: "圆号", instrumentGuess: "F调圆号" },
      expected: "text-success",
    },
    { name: "uploading → text-primary", over: { status: "uploading" }, expected: "text-primary" },
    { name: "done → text-success", over: { status: "done" }, expected: "text-success" },
    {
      // 未识别那条判据只对 analyzed 生效；失败行有乐器也别被它抢走。
      name: "error → text-danger（即使没有乐器）",
      over: { status: "error", error: "x" },
      expected: "text-danger",
    },
    {
      name: "error + 有乐器 → text-danger",
      over: { status: "error", instrumentGuess: "F调圆号", error: "x" },
      expected: "text-danger",
    },
    {
      name: "done + 没有乐器 → text-success（不是「未识别」）",
      over: { status: "done" },
      expected: "text-success",
    },
  ];
  for (const c of colorCases) {
    it(`statusColor：${c.name}`, () => expect(statusColor(row(c.over))).toBe(c.expected));
  }
});

describe("sectionWarning：声部词表漂移的可见信号", () => {
  const cases: Array<{ name: string; over: Partial<UploadFile>; expected: string }> = [
    { name: "标准声部 → 不告警", over: { sectionGuess: "圆号" }, expected: "" },
    { name: "总谱是合法值 → 不告警", over: { sectionGuess: "总谱" }, expected: "" },
    {
      name: "「其他」是契约里的合法弃权声部 → 不告警",
      over: { sectionGuess: "其他" },
      expected: "",
    },
    {
      name: "标准列表外的声部 → 告警（词表漂移的唯一可见信号）",
      over: { sectionGuess: "木管" },
      expected: "声部「木管」不在标准列表内",
    },
    {
      name: "两侧 trim 后再判（模型给的「 木管 」不能绕过告警）",
      over: { sectionGuess: " 木管 " },
      expected: "声部「木管」不在标准列表内",
    },
    {
      // Edit 压过 Guess：用户已经改对了，不该再报模型那个值。
      name: "用户改成标准声部（Edit 压过 Guess）→ 不告警",
      over: { sectionEdit: "圆号", sectionGuess: "木管" },
      expected: "",
    },
    {
      name: "用户改成列表外声部 → 报用户当前的值",
      over: { sectionEdit: "木管", sectionGuess: "圆号" },
      expected: "声部「木管」不在标准列表内",
    },
    {
      // `??` 而不是 `||`：空串是用户主动清空，不能把 Guess 捡回来再告警一次。
      name: "用户清空声部（Edit 空串压过 Guess）→ 不告警",
      over: { sectionEdit: "", sectionGuess: "木管" },
      expected: "",
    },
    {
      // 模型返回词表外声部时后端已折成「其他」；原值只在 sectionRaw 里，
      // 不看它就等于「漂移」与「模型真的判不出来」在界面上长得一样。
      name: "当前没有声部、模型曾给出列表外原值 → 陈述过去式",
      over: { sectionRaw: "木管" },
      expected: "模型曾给出声部「木管」（不在标准列表内）",
    },
    {
      // 告警陈述的是模型**当时**给过什么，不随用户的修改消失（用过去式）。
      name: "用户已改成标准声部、但 Raw 还在 → 过去式那句仍挂着",
      over: { sectionGuess: "圆号", sectionRaw: "木管" },
      expected: "模型曾给出声部「木管」（不在标准列表内）",
    },
    {
      // 两条同时成立时只报**当前值**那条：说成「模型曾给出」会让用户以为自己的修改没生效。
      name: "当前值列表外 + Raw 也在 → 只报当前值（两条不叠）",
      over: { sectionGuess: "巴松管", sectionRaw: "木管" },
      expected: "声部「巴松管」不在标准列表内",
    },
    {
      name: "Raw 是空串 → 不是信号，不告警",
      over: { sectionRaw: "" },
      expected: "",
    },
  ];
  for (const c of cases) {
    it(c.name, () => expect(sectionWarning(row(c.over))).toBe(c.expected));
  }
});

describe("evidenceLine：让用户一眼复核模型的依据", () => {
  const cases: Array<{ name: string; over: Partial<UploadFile>; expected: string | null }> = [
    // 只有 analyzed / done 才有「这一行识别出了什么」可言；其余状态一律不显示。
    { name: "pending → 不显示", over: { status: "pending", evidence: "x" }, expected: null },
    { name: "analyzing → 不显示", over: { status: "analyzing", evidence: "x" }, expected: null },
    { name: "uploading → 不显示", over: { status: "uploading", evidence: "x" }, expected: null },
    { name: "error → 不显示", over: { status: "error", evidence: "x" }, expected: null },
    {
      // 字段缺失 = 「这一行没有这个信号」；与「模型没给引文」是两件事，
      // 判的是 `=== undefined` 而不是 falsy —— 否则会编一句「请核对」。
      name: "analyzed + evidence 缺失 → 不显示（不是「没给引文」）",
      over: { status: "analyzed" },
      expected: null,
    },
    {
      name: "done + evidence 缺失 → 不显示",
      over: { status: "done" },
      expected: null,
    },
    {
      name: "analyzed + evidence 空串 → 「模型没给引文，请核对」",
      over: { status: "analyzed", evidence: "" },
      expected: "依据：（模型没给引文，请核对）",
    },
    {
      name: "analyzed + evidence 只有空白 → 同上（trim 后为空）",
      over: { status: "analyzed", evidence: "   " },
      expected: "依据：（模型没给引文，请核对）",
    },
    {
      name: "analyzed + 找到引文 → 普通依据",
      over: { status: "analyzed", evidence: "Corno I in F." },
      expected: "依据：Corno I in F.",
    },
    {
      name: "引文两侧空白被 trim 掉（模型多打空格不能弄脏界面）",
      over: { status: "analyzed", evidence: "  Corno I in F.  " },
      expected: "依据：Corno I in F.",
    },
    {
      // evidenceFound === false 是**信号不是门**：答案照用，只是提示用户核对。
      name: "analyzed + evidenceFound=false → 「未在原文中找到，请核对」",
      over: { status: "analyzed", evidence: "Corno I in F.", evidenceFound: false },
      expected: "依据（未在原文中找到，请核对）：Corno I in F.",
    },
    {
      name: "analyzed + evidenceFound=true → 普通依据",
      over: { status: "analyzed", evidence: "Corno I in F.", evidenceFound: true },
      expected: "依据：Corno I in F.",
    },
    {
      // 缺字段 ≠ false：缺失时不进「未找到」那一支。
      name: "analyzed + evidenceFound 缺失 → 普通依据（不能当成 false）",
      over: { status: "analyzed", evidence: "Corno I in F." },
      expected: "依据：Corno I in F.",
    },
    {
      // 引文只在文件名里：依据是正当的，但用户该去核对的地方不同（看文件名，不是看谱面）。
      name: "done + evidenceFromFileName → 「来自文件名，不在页面上」",
      over: { status: "done", evidence: "Horn_2", evidenceFromFileName: true },
      expected: "依据（来自文件名，不在页面上）：Horn_2",
    },
    {
      // 两条同时成立时「来自文件名」优先：它不能同时被判成「哪儿都没找到」。
      name: "evidenceFromFileName 与 evidenceFound=false 并存 → 只报来自文件名",
      over: {
        status: "analyzed",
        evidence: "Horn_2",
        evidenceFromFileName: true,
        evidenceFound: false,
      },
      expected: "依据（来自文件名，不在页面上）：Horn_2",
    },
    {
      // 没有引文时「来自文件名」也无从谈起（判据顺序：先判 evidence 缺失）。
      name: "evidence 缺失 + evidenceFromFileName=true → 仍不显示",
      over: { status: "analyzed", evidenceFromFileName: true },
      expected: null,
    },
  ];
  for (const c of cases) {
    it(c.name, () => expect(evidenceLine(row(c.over))).toBe(c.expected));
  }
});

describe("evidenceWarn：依据要不要按警示色显示", () => {
  const cases: Array<{ name: string; over: Partial<UploadFile>; expected: boolean }> = [
    {
      name: "引文没在原文里找到 → 警示",
      over: { evidence: "x", evidenceFound: false },
      expected: true,
    },
    {
      // 缺失 ≠ false：没有这个信号时不警示（与 evidenceLine 不显示配套）。
      name: "evidenceFound 缺失 → 不警示",
      over: { evidence: "x" },
      expected: false,
    },
    {
      name: "evidenceFound=true → 不警示",
      over: { evidence: "x", evidenceFound: true },
      expected: false,
    },
    {
      name: "evidence 缺失 → 警示（没有依据可核对）",
      over: {},
      expected: true,
    },
    {
      name: "evidence 空串 → 警示（模型没给引文）",
      over: { evidence: "" },
      expected: true,
    },
    {
      name: "evidence 只有空白 → 警示（trim 后为空）",
      over: { evidence: "   " },
      expected: true,
    },
    {
      // 来自文件名是**正当依据**，不是「没找到」；只有 evidenceFound 决定颜色。
      name: "来自文件名 + evidenceFound=true → 不警示",
      over: { evidence: "x", evidenceFound: true, evidenceFromFileName: true },
      expected: false,
    },
    {
      name: "来自文件名 + evidenceFound 缺失 → 不警示",
      over: { evidence: "x", evidenceFromFileName: true },
      expected: false,
    },
  ];
  for (const c of cases) {
    it(c.name, () => expect(evidenceWarn(row(c.over))).toBe(c.expected));
  }
});
