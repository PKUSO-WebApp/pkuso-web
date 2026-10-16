/**
 * `auto-segment.ts` 的纯单测（#386）。
 *
 * 每一条都写清「它在防什么」，并且标出**哪一处改动会让它变红** —— 断言的鉴别力靠的就是这个。
 * 集成层面（真组件里勾开关 → 分析收尾 → 真点火）的用例在另一个文件里，这里只管判据本身。
 */
import { describe, expect, it } from "vitest";
import type { UploadFile } from "./upload-modal.types";
import {
  AUTO_SEGMENT_DEFAULT,
  autoSegmentPlan,
  autoSegmentRowVerdict,
  type AutoSegmentInput,
  type SegAutoTarget,
} from "./auto-segment";

const row = (over: Partial<UploadFile> = {}): UploadFile => ({
  file: new File([], "x.pdf"),
  originalName: "x.pdf",
  status: "analyzed",
  pageCount: 3,
  sectionGuess: "圆号",
  instrumentGuess: "圆号",
  ...over,
});

/** 闸门全开的输入。各条用例只改它要考的那一维 —— 这样「是谁拦下的」没有歧义。 */
const gate = (over: Partial<AutoSegmentInput> = {}): AutoSegmentInput => ({
  enabled: true,
  phase: "confirm",
  files: [row()],
  hasAnalyzingFiles: false,
  segBusy: false,
  refiningCount: 0,
  ...over,
});

const targetsOf = (plan: ReturnType<typeof autoSegmentPlan>): SegAutoTarget[] => {
  if (!plan.fire) throw new Error(`期望点火，实际被拦：${plan.reason}`);
  return plan.targets;
};

describe("默认关（#386：自动点火会烧 N 次 OCR，必须由人显式勾）", () => {
  it("开关初值是关的", () => {
    // 组件取初值读的就是它（`useState(AUTO_SEGMENT_DEFAULT)`），所以这条不是「测一个常量」：
    // ★ 变异：`AUTO_SEGMENT_DEFAULT` 改成 `true` → 这一条变红，且整个对照组失效。
    expect(AUTO_SEGMENT_DEFAULT).toBe(false);
  });

  it("对照组真跑：同一批合格的行，关着不点火、打开才点火", () => {
    // ⚠️ 这条是**反空转**用的：只有「关着不点火」而没有「打开真点火」的话，
    // 一个恒返回 `{ fire: false }` 的实现也能让上面那条负向断言全绿。
    const files = [row()];
    const base = { files, hasAnalyzingFiles: false, segBusy: false, refiningCount: 0 };
    const off = autoSegmentPlan({ ...base, phase: "confirm", enabled: false });
    expect(off).toEqual({ fire: false, reason: "switch-off" });
    expect(targetsOf(autoSegmentPlan({ ...base, phase: "confirm", enabled: true }))).toEqual([
      { f: files[0], i: 0 },
    ]);
  });
});

describe("批次闸门：与手点那条路的在飞判据同源（否则会出现「按钮还灰着、自动却跑了」）", () => {
  it("阶段不在 confirm（分析中 / 上传中 / 选文件）一律不点火", () => {
    for (const phase of ["select", "analyzing", "uploading"] as const) {
      const plan = autoSegmentPlan(gate({ phase }));
      // ★ 变异：删掉 `phase !== "confirm"` 那一行 → 这三拍都会点火 → 变红。
      expect(plan).toEqual({ fire: false, reason: "not-settled" });
    }
  });

  it("还有行在分析中（含逐行重试）不点火 —— 在飞行集上拆行会让任务写错行", () => {
    // ★ 变异：删掉 `hasAnalyzingFiles` 那一行 → 这一条变红（变成 fire:true）。
    expect(autoSegmentPlan(gate({ hasAnalyzingFiles: true }))).toEqual({
      fire: false,
      reason: "analyzing",
    });
  });

  it("上一轮分段还在飞（segBusy）不点火 —— 重入", () => {
    const plan = autoSegmentPlan(gate({ segBusy: true }));
    // ★ 变异：删掉 `segBusy` 那一行 → 这一条变红。
    // ⚠️ 它挡的是**同一个组件内**的重入：分段跑完前 `segState` 还是 `undefined`
    //（`running` 是在 worker 里逐行写的），只看行级判据的话第二拍还会再点一次火。
    expect(plan).toEqual({ fire: false, reason: "segmenting" });
  });

  it("段级识别还在飞（refiningCount）不点火", () => {
    // ★ 变异：删掉 `refiningCount > 0` 那一行 → 这一条变红。
    expect(autoSegmentPlan(gate({ refiningCount: 1 }))).toEqual({
      fire: false,
      reason: "refining",
    });
  });

  it("闸门都开着但一行都不合格时不点火（免得空转起一个池子）", () => {
    const plan = autoSegmentPlan(gate({ files: [row({ pageCount: 1 })] }));
    // ★ 变异：删掉 `targets.length === 0` 那一行 → 空目标集也会「点火」→ 变红。
    expect(plan).toEqual({ fire: false, reason: "nothing-to-do" });
  });
});

describe("行级判据：谁会进目标集", () => {
  it("合格的行进目标集（多页、非总谱、认得出乐器、还没跑过分段）", () => {
    expect(autoSegmentRowVerdict(row())).toEqual({ segment: true, reason: "todo" });
  });

  it("没分析完的不算「不跑」，只是「这一拍轮不到」", () => {
    for (const status of ["pending", "analyzing", "uploading", "done", "error"] as const) {
      // ★ 变异：删掉 `f.status !== "analyzed"` 那一行 → `pending` / `analyzing` 的行
      // 会落到下面几步（弃权？资格？）→ 原因码不再是 `not-ready` → 变红。
      expect(autoSegmentRowVerdict(row({ status }))).toEqual({
        segment: false,
        reason: "not-ready",
      });
    }
  });

  it("分段已有结论的行（running / done / **error**）都不再自动跑", () => {
    for (const segState of ["running", "done", "error"] as const) {
      expect(autoSegmentRowVerdict(row({ segState }))).toEqual({
        segment: false,
        reason: "already-run",
      });
    }
  });

  it("**失败的行不由自动路径重试** —— 否则「失败 → 收尾 → 再失败」是无界循环", () => {
    const failed = row({ segState: "error", segError: "OCR 超时" });
    const fresh = row();
    const plan = autoSegmentPlan(gate({ files: [failed, fresh] }));
    // ★ 变异：删掉 `f.segState !== undefined` 那一行 → failed 也进目标集
    //（`segEligible` 对它是真的：状态是 analyzed、页数还在）→ 变红。
    expect(targetsOf(plan).map((t) => t.i)).toEqual([1]);
  });

  it("弃权行（instrument 为空）永不自动推进 —— 两个原因码都指向它", () => {
    const abstained = row({ instrumentGuess: "" });
    // ① 行级：原因码是 `abstained` 而不是兜底的 `not-eligible`（排查时要能一眼看出是弃权）
    // ★ 变异：删掉 `isUnidentified(f)` 那一行 → 原因码变成 `not-eligible` → 变红。
    expect(autoSegmentRowVerdict(abstained)).toEqual({ segment: false, reason: "abstained" });

    // ② 批次级（**行为层面的保证在这里**）：同一批里别的行合格、整批起跑，
    // 弃权行也不得进目标集 —— 进不去就不会为它烧那 N 次 OCR。
    // ★ 变异：把 `segEligible` 里的 `!isUnidentified(f) &&` 删掉（`row-text.ts`）→
    // 弃权行进目标集 → 这一条变红。
    const plan = autoSegmentPlan(gate({ files: [abstained, row()] }));
    expect(targetsOf(plan).map((t) => t.i)).toEqual([1]);
  });

  it("与手点同源的资格判据：单页 / 总谱 / 切出来的段都进不去", () => {
    const single = row({ pageCount: 1 });
    const fullScore = row({ sectionGuess: "总谱" });
    const split = row({ splitOf: { groupId: "g1", from: 1, to: 1, segIndex: 1, segTotal: 2 } });
    for (const f of [single, fullScore, split]) {
      // ★ 变异：把 `segEligible` 整个换成 `true` → 这三行都会进目标集 → 变红。
      // ⚠️ 这一条**不重测** `segEligible` 自己（那是 `row-text.test.ts` 的事），
      // 它钉的是「自动路径确实从那个判据取数」——少了这条，本模块可以自己写一份
      // 宽松的资格判据而没人发现。
      expect(autoSegmentRowVerdict(f)).toEqual({ segment: false, reason: "not-eligible" });
    }
  });
});
