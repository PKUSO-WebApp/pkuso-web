/**
 * `auto-upload.ts` 的**直接单测**（pkuso-web#386 第一阶段）。
 *
 * 这些判据里有一部分本该由集成用例（驱动真组件）来钉，但本阶段
 * `upload-modal-walk.test.tsx` 被另一个 agent 独占 —— 所以凡是能抽成纯函数的
 * 都抽出来在这里钉死；「真的跳过了哪几行、真的没发第二次请求」那种只有真组件
 * 才看得见的证据，在第二阶段补（见 issue 上的契约）。
 *
 * 每条都写清**它在防什么**，并且**反例必须配正例**：只有反例的用例，判据写成
 * 恒假也照样全绿（那种「断言对、期望对、验错东西」的坑本仓栽过）。
 */
import { afterEach, describe, expect, it } from "vitest";
import type { UploadFile } from "./upload-modal.types";
import {
  AUTO_UPLOAD_PREF_KEY,
  autoUploadBatch,
  autoUploadVerdict,
  readAutoUploadPref,
  writeAutoUploadPref,
  type AutoUploadGuards,
} from "./auto-upload";
import { editsOf, uploadBlocker } from "./row-text";

/** 零宽空格：`trim` 删不掉、肉眼看不见 —— 用来测「读起来是空、其实有个名字」那一格 */
const ZWSP = "\u200b";

/** \u6bb5\u884c\u8eab\u4e0a\u7684 `splitOf`\uff08\u6e90\u884c\u8eab\u4efd + \u5b83\u662f\u7b2c\u51e0\u6bb5\uff09\u3002\u7528\u771f\u5f62\u72b6\uff0c\u522b\u7528\u5b57\u7b26\u4e32\u51d1\u5408 */
const SPLIT_OF = { groupId: "g1", from: 1, to: 2, segIndex: 0, segTotal: 2 };

const row = (over: Partial<UploadFile> = {}): UploadFile => ({
  file: new File([], "x.pdf"),
  originalName: "x.pdf",
  status: "pending",
  ...over,
});

/** 就绪：分析完了、名字齐、不用分段。下面每组的反例都拿它当对照 */
const ready = (over: Partial<UploadFile> = {}) =>
  row({ status: "analyzed", sectionGuess: "圆号", instrumentGuess: "F调圆号", ...over });

/** 弃权：模型没认出乐器（后端用空串表示） */
const abstained = (over: Partial<UploadFile> = {}) =>
  row({ status: "analyzed", sectionGuess: "圆号", instrumentGuess: "", ...over });

/** 守卫全清（其余字段按需覆盖）。相位是 `confirm` —— 「分析完了、人在看」那一刻 */
const guards = (over: Partial<AutoUploadGuards> = {}): AutoUploadGuards => ({
  enabled: true,
  // 与界面上的默认值一致（「乐谱分段」默认开着）—— 要测「关掉它」的用例自己覆盖
  segmentEnabled: true,
  phase: "confirm",
  hasAnalyzingFiles: false,
  segBusy: false,
  refiningCount: 0,
  ...over,
});

describe("开关关着：任何行都不放行（对照组）", () => {
  it("就绪行也一样被开关挡住", () => {
    expect(autoUploadVerdict(ready(), false)).toEqual({ upload: false, reason: "switch-off" });
  });

  it("行换成别的形状，原因还是 switch-off —— 开关是**先于一切**的那一条", () => {
    // 换句话讲：只要开关关着，判据就不该看任何别的东西。少这一条的话，
    // 「先判了弃权再判开关」这种写法也能让上面那一条绿。
    for (const r of [
      abstained(),
      row({ status: "analyzed", sectionGuess: "圆号", instrumentGuess: "长笛|1" }),
      row({
        status: "analyzed",
        sectionGuess: "圆号",
        instrumentGuess: "长笛",
        pageCount: 4,
        segmentStarts: [1, 3],
      }),
      row({ status: "done", sectionGuess: "圆号", instrumentGuess: "F调圆号" }),
      row({ status: "analyzing" }),
    ]) {
      expect(autoUploadVerdict(r, false)).toEqual({ upload: false, reason: "switch-off" });
    }
  });

  it("批次也一样：守卫全清、也有就绪行，开关关着就是不点火", () => {
    expect(autoUploadBatch([ready()], guards({ enabled: false }))).toEqual({
      fire: false,
      reason: "switch-off",
    });
  });
});

describe("弃权行永不自动传（issue 里点名的硬规矩）", () => {
  it("模型弃权（`instrumentGuess` 是空串）→ abstained", () => {
    expect(autoUploadVerdict(abstained(), true)).toEqual({ upload: false, reason: "abstained" });
  });

  it("用户把名字清空（`instrumentEdit` 是空串）→ abstained（Edit 优先，不能把 Guess 捡回来）", () => {
    // 与上一条是**两次不同的输入**：字段不同，覆盖的失效方式也不同（模型没说 vs 人删了）
    expect(
      autoUploadVerdict(abstained({ instrumentGuess: "F调圆号", instrumentEdit: "" }), true),
    ).toEqual({ upload: false, reason: "abstained" });
  });

  it("只有空白的名字算弃权；只有不可见字符的由 blocked 兜住（两层各管一段）", () => {
    // 空白：`editsOf` trim 之后就是空串 → abstained
    expect(autoUploadVerdict(abstained({ instrumentGuess: "   " }), true)).toEqual({
      upload: false,
      reason: "abstained",
    });
    // 零宽空格不是空白（`trim` 不动它）→ 到不了 abstained，靠 `uploadBlocker` 的
    // isBlankName 拦下 —— 这一行**也是**「放弃传给用户看」，只是原因码不同：
    // 前者是「模型弃权」，后者是「这名字落不下去」
    expect(autoUploadVerdict(abstained({ instrumentGuess: ZWSP }), true)).toEqual({
      upload: false,
      reason: "blocked",
    });
  });

  it("**整批只有弃权行时不点火** —— 这条是「弃权行不让工作起跑」的直接证据", () => {
    expect(autoUploadBatch([abstained()], guards())).toEqual({
      fire: false,
      reason: "nothing-ready",
    });
  });

  it("混批：整批会起跑，但弃权行**自己**仍然不放行，靠第二层 uploadBlocker 挡在库外", () => {
    // 这一条钉的是**两层**保证分别在不在（本阶段故意不做行级过滤，见 issue 契约的
    // 「本次明确不覆盖」）。只写「批会起跑」是不够的：那一条在判据退化成恒真时也绿。
    expect(autoUploadBatch([ready(), abstained()], guards())).toEqual({ fire: true });

    const e = editsOf(abstained());
    expect(autoUploadVerdict(abstained(), true).upload).toBe(false);
    expect(
      uploadBlocker({
        section: e.section,
        instrument: e.instrument,
        subPartsInvalid: e.subPartsInvalid,
        subPartsUnread: e.subPartsUnread,
      }),
    ).not.toBe("");
  });
});

describe("行级：只有「已分析」才算就绪", () => {
  it("已分析 + 名字齐 → 就绪（正例：下面那一排反例都拿它当对照）", () => {
    expect(autoUploadVerdict(ready(), true)).toEqual({ upload: true });
  });

  it("还没分析完（pending / analyzing）→ not-ready", () => {
    expect(autoUploadVerdict(row({ status: "pending" }), true)).toEqual({
      upload: false,
      reason: "not-ready",
    });
    expect(autoUploadVerdict(row({ status: "analyzing" }), true)).toEqual({
      upload: false,
      reason: "not-ready",
    });
  });

  it("**已传完（done）不再被挑第二次**；正在传（uploading）也不会", () => {
    // 「同一行不重复传」在判据层就靠这一条 —— 名字齐不齐在这里无关紧要
    expect(autoUploadVerdict(ready({ status: "done" }), true)).toEqual({
      upload: false,
      reason: "not-ready",
    });
    expect(autoUploadVerdict(ready({ status: "uploading" }), true)).toEqual({
      upload: false,
      reason: "not-ready",
    });
  });

  it("分析成功但上传失败（error）→ not-ready：**不自动重试**，重试仍由人点", () => {
    // 自动重试会变成失败—重试的无界循环（契约里明确不覆盖的那一条）
    expect(autoUploadVerdict(ready({ status: "error" }), true)).toEqual({
      upload: false,
      reason: "not-ready",
    });
  });
});

describe("行级：其余拦截与手动上传同一道闸（uploadBlocker）", () => {
  it("名字里有落不下去的字符 → blocked", () => {
    expect(autoUploadVerdict(ready({ instrumentGuess: "长笛|1" }), true)).toEqual({
      upload: false,
      reason: "blocked",
    });
  });

  it("声部是空的 → blocked（弃权判的是乐器名，声部缺失不是弃权）", () => {
    expect(autoUploadVerdict(ready({ sectionGuess: "" }), true)).toEqual({
      upload: false,
      reason: "blocked",
    });
  });

  it("模型给了号却没人读懂、用户还没表态 → blocked", () => {
    expect(autoUploadVerdict(ready({ subPartsGuess: [], subPartsRaw: "Ⅰ" }), true)).toEqual({
      upload: false,
      reason: "blocked",
    });
  });

  it("分声部号非法（用户输入）→ blocked", () => {
    expect(autoUploadVerdict(ready({ subPartsEditText: "1-" }), true)).toEqual({
      upload: false,
      reason: "blocked",
    });
  });
});

describe("行级：识别出多段却还没拆 → 不就绪", () => {
  const multi = { status: "analyzed" as const, sectionGuess: "圆号", instrumentGuess: "长笛" };

  it("多页、两个段、没拆 → unsplit", () => {
    expect(autoUploadVerdict(row({ ...multi, pageCount: 4, segmentStarts: [1, 3] }), true)).toEqual(
      {
        upload: false,
        reason: "unsplit",
      },
    );
  });

  it("多页但只有一段（`[1]`，即明确不切）→ 就绪（正例）", () => {
    expect(autoUploadVerdict(row({ ...multi, pageCount: 4, segmentStarts: [1] }), true)).toEqual({
      upload: true,
    });
  });

  it("已经拆出来的段行 → 就绪（正例：拦的是「还没拆」，不是「拆过的行」）", () => {
    expect(
      autoUploadVerdict(
        row({ ...multi, pageCount: 4, segmentStarts: [1, 3], splitOf: SPLIT_OF }),
        true,
      ),
    ).toEqual({ upload: true });
  });

  it("总谱不参与分段：`segmentStarts` 是旧值也不拦（正例）", () => {
    // 用户在分段跑完之后把声部改成总谱 —— `segEligible` 为假，分段块整块不渲染，
    // 拦截若还认段就会指着屏幕上看不见的按钮（row-text 里记着这条实测）
    expect(
      autoUploadVerdict(
        row({
          status: "analyzed",
          sectionGuess: "总谱",
          instrumentGuess: "总谱",
          pageCount: 4,
          segmentStarts: [1, 3],
        }),
        true,
      ),
    ).toEqual({ upload: true });
  });
});

describe("批次闸门：安静下来之前不点火", () => {
  it("守卫全清 + 有就绪行 → 点火（正例）", () => {
    expect(autoUploadBatch([ready()], guards())).toEqual({ fire: true });
  });

  it("不在「确认」相（选文件 / 分析中 / 上传中）→ not-confirmed", () => {
    for (const phase of ["select", "analyzing", "uploading"] as const) {
      expect(autoUploadBatch([ready()], guards({ phase }))).toEqual({
        fire: false,
        reason: "not-confirmed",
      });
    }
  });

  it("**还有行在分析** → analyzing：即便同批里有就绪行也不点", () => {
    // 就绪行在这里没用 —— 分析还在写回行状态，此刻起跑就是 #304 那条「异步写回与分段冲突」
    expect(
      autoUploadBatch([ready(), row({ status: "analyzing" })], guards({ hasAnalyzingFiles: true })),
    ).toEqual({ fire: false, reason: "analyzing" });
  });

  it("分段在跑 → segmenting", () => {
    expect(autoUploadBatch([ready()], guards({ segBusy: true }))).toEqual({
      fire: false,
      reason: "segmenting",
    });
  });

  it("段级识别飞行中（refiningCount > 0）→ refining", () => {
    // 飞行中时行上的乐器名还可能被识别结果改掉，此时传出去的是**半截判断**
    expect(autoUploadBatch([ready()], guards({ refiningCount: 1 }))).toEqual({
      fire: false,
      reason: "refining",
    });
    expect(autoUploadBatch([ready()], guards({ refiningCount: 3 }))).toEqual({
      fire: false,
      reason: "refining",
    });
  });

  it("分段与段级识别同时在跑：先报 segmenting（顺序是判据的一部分）", () => {
    expect(autoUploadBatch([ready()], guards({ segBusy: true, refiningCount: 2 }))).toEqual({
      fire: false,
      reason: "segmenting",
    });
  });

  it("守卫全清、但一行就绪的都没有 → nothing-ready 不点火", () => {
    // 「安静下来」不等于「该点」：一批全 pending / 全 done 的批不该起跑
    expect(
      autoUploadBatch([row({ status: "pending" }), ready({ status: "done" })], guards()),
    ).toEqual({ fire: false, reason: "nothing-ready" });
  });

  it("空批 → nothing-ready（`some` 空数组为假，别写成 `every` 那种恒真）", () => {
    expect(autoUploadBatch([], guards())).toEqual({ fire: false, reason: "nothing-ready" });
  });
});

describe("批次闸门：还有行在等分段时不点火（分段开关开着才有这一条）", () => {
  /** 多页合订谱：分析完了、名字齐、**分段还没跑** —— 判据眼里它是「就绪」的，这正是危险处 */
  const composite = (over: Partial<UploadFile> = {}) =>
    row({
      status: "analyzed",
      sectionGuess: "圆号",
      instrumentGuess: "长笛",
      pageCount: 9,
      ...over,
    });

  it("分段开着、合订谱还没跑分段 → segment-pending", () => {
    // 起跑就会把它整份传上去；而它一转 done，`segEligible` 为假、「识别分段」按钮
    // 连出现的机会都没有 —— 用户打开分段开关的意图被静默作废
    expect(autoUploadBatch([composite()], guards({ segmentEnabled: true }))).toEqual({
      fire: false,
      reason: "segment-pending",
    });
  });

  it("段级识别跑完、结论是「不用切」（`segState: done` 且只剩一段）→ 起跑（正例）", () => {
    expect(
      autoUploadBatch(
        [composite({ segState: "done", segmentStarts: [1], segmentStartText: ["1"] })],
        guards({ segmentEnabled: true }),
      ),
    ).toEqual({ fire: true });
  });

  it("已经拆出来的段行 → 不等（`segEligible` 对段行为假）（正例）", () => {
    expect(
      autoUploadBatch(
        [composite({ splitOf: SPLIT_OF, pageCount: 3, segState: "done" })],
        guards({ segmentEnabled: true }),
      ),
    ).toEqual({ fire: true });
  });

  it("分段总开关关着 → 不等，直接起跑（正例：「我不打算分段」的明确表态）", () => {
    expect(autoUploadBatch([composite()], guards({ segmentEnabled: false }))).toEqual({
      fire: true,
    });
  });

  it("分段失败（`segState: error`）仍然算「在等」—— 重试或跳过都得由人来表态", () => {
    expect(
      autoUploadBatch([composite({ segState: "error" })], guards({ segmentEnabled: true })),
    ).toEqual({ fire: false, reason: "segment-pending" });
  });

  it("**混批：只要还有一行在等分段，整批都不点火**（本阶段不做行级过滤，见契约）", () => {
    // 单页那行自己是就绪的，但它不能把等分段的合订谱一起带上 —— 行级过滤是另一件事
    expect(autoUploadBatch([ready(), composite()], guards({ segmentEnabled: true }))).toEqual({
      fire: false,
      reason: "segment-pending",
    });
  });
});

describe("偏好读写（本地偏好，与 `pkuso-theme` 同一套写法）", () => {
  afterEach(() => window.localStorage.clear());

  it("没有记录 → 关（默认关）", () => {
    expect(readAutoUploadPref(window.localStorage)).toBe(false);
  });

  it('`"1"` → 开', () => {
    window.localStorage.setItem(AUTO_UPLOAD_PREF_KEY, "1");
    expect(readAutoUploadPref(window.localStorage)).toBe(true);
  });

  it('别的值一律当关（含 `"0"` / `"true"` / 空串 / 读不懂的）', () => {
    // `" 1 "` 与 `"١"`（阿拉伯数字 1）是两条**能鉴别实现方式**的反例：
    // 前者的存在要求不能用 `trim()`，后者的存在要求不能用 `Number(raw) === 1`
    for (const v of ["0", "true", "on", "", " 1 ", "١"]) {
      window.localStorage.setItem(AUTO_UPLOAD_PREF_KEY, v);
      expect(readAutoUploadPref(window.localStorage)).toBe(false);
    }
  });

  it("storage 为 null（SSR / 注入不传）→ 关", () => {
    expect(readAutoUploadPref(null)).toBe(false);
  });

  it("读抛异常（隐私模式等）→ 关，不抛出", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(readAutoUploadPref(throwing as never)).toBe(false);
  });

  it('写「开」落的就是 `"1"`，读回来是开', () => {
    writeAutoUploadPref(true, window.localStorage);
    expect(window.localStorage.getItem(AUTO_UPLOAD_PREF_KEY)).toBe("1");
    expect(readAutoUploadPref(window.localStorage)).toBe(true);
  });

  it('写「关」是**删键**，不是写 `"0"`（不留与默认同义的记录）', () => {
    writeAutoUploadPref(true, window.localStorage);
    writeAutoUploadPref(false, window.localStorage);
    expect(window.localStorage.getItem(AUTO_UPLOAD_PREF_KEY)).toBeNull();
    expect(readAutoUploadPref(window.localStorage)).toBe(false);
  });

  it("写抛异常（存满 / 隐私模式）→ 不抛出，本次会话内不持久化而已", () => {
    const throwing = {
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeAutoUploadPref(true, throwing as never)).not.toThrow();
    expect(() => writeAutoUploadPref(false, throwing as never)).not.toThrow();
    expect(() => writeAutoUploadPref(true, null)).not.toThrow();
  });
});
