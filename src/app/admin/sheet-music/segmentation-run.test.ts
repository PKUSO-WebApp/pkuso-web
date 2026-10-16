import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_TIMEOUT_MS } from "./analysis";
import { requestSegmentation } from "./segmentation-run";
import type { PageText } from "./upload-modal.types";

/**
 * `requestSegmentation` 的职责只有一条：**把后端的响应交出去**（包括「为什么没切」），
 * 校验不在这里（`segmentation.ts` 的 `startsFromResponse` 只信 `cuts`）。这里钉三件事：
 *
 * 1. **不许再丢字段**（pkuso-backend#96 §3.2）：`rawCuts` / `rejected` 要带得回来 ——
 *    否则「模型弃权」与「模型给了切点但被证据校验丢掉」在调用方这一层**仍然同形**，
 *    而那两种情况的修法相反（改 prompt vs 改校验），分不开就永远查不出是哪一种。
 * 2. `cuts` 保持 `unknown` 原样传下去：这里补 `?? []` 会把「后端没回这个字段」抹平。
 * 3. 两条抛错分支（传输层 `error` / `success: false`）不许被改动碰坏。
 */

const h = vi.hoisted(() => ({
  calls: [] as { name: string; body: Record<string, unknown>; timeout?: number }[],
  /** 依次返回；用完后返回 `{ data: null, error: null }` */
  results: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: {
      invoke: async (name: string, opts: { body: Record<string, unknown>; timeout?: number }) => {
        h.calls.push({ name, body: opts.body, timeout: opts.timeout });
        return h.results.length ? h.results.shift() : { data: null, error: null };
      },
    },
  },
}));

beforeEach(() => {
  h.calls.length = 0;
  h.results.length = 0;
});

const pageTexts: PageText[] = [
  { page: 1, text: "Corno I in F" },
  { page: 2, text: "2" },
  { page: 4, text: "Corno II in F" },
];

describe("requestSegmentation —— 响应形状", () => {
  it("正常响应：cuts / evidence 原样交出，请求体只有页数与各页文本", async () => {
    h.results.push({
      data: {
        success: true,
        cuts: [4],
        evidence: ["Corno II in F"],
        rawCuts: [4],
        rejected: [],
      },
      error: null,
    });

    const res = await requestSegmentation(4, pageTexts);

    expect(res.cuts).toEqual([4]);
    expect(res.evidence).toEqual(["Corno II in F"]);
    expect(res.rawCuts).toEqual([4]);
    expect(res.rejected).toEqual([]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe("segment-parts");
    expect(h.calls[0].body).toEqual({ pageCount: 4, pages: pageTexts });
    // 不发文件名：合订谱的名字里写着 `_1,2,3,4`，会把模型锚定在「应该有 4 段」上
    expect(Object.keys(h.calls[0].body).sort()).toEqual(["pageCount", "pages"]);
    expect(h.calls[0].timeout).toBe(LLM_TIMEOUT_MS);
  });

  it("**弃权 与 被丢掉 在调用方这一层可区分**（#96 §3.2 的整条理由）", async () => {
    // 模型什么都没给
    h.results.push({
      data: { success: true, cuts: [], evidence: [], rawCuts: [], rejected: [] },
      error: null,
    });
    const abstain = await requestSegmentation(4, pageTexts);

    // 模型给了第 4 页，但引文在那一页的窄带原文里找不到 ⇒ 被证据校验丢掉
    h.results.push({
      data: {
        success: true,
        cuts: [],
        evidence: [],
        rawCuts: [4],
        rejected: [{ page: 4, reason: "evidence-unsupported", evidence: "Oboe I in C" }],
      },
      error: null,
    });
    const dropped = await requestSegmentation(4, pageTexts);

    // 两种情况的 cuts 一模一样 —— 这正是改动前的全部信息
    expect(abstain.cuts).toEqual([]);
    expect(dropped.cuts).toEqual([]);
    // 新增的两个字段把它们分开了
    expect(abstain.rawCuts).toEqual([]);
    expect(dropped.rawCuts).toEqual([4]);
    expect(dropped.rejected).toEqual([
      { page: 4, reason: "evidence-unsupported", evidence: "Oboe I in C" },
    ]);
    expect(dropped).not.toEqual(abstain);
  });

  it("cuts 不做校验、不补默认值：不是数组也原样传下去（类型是 unknown）", async () => {
    h.results.push({ data: { success: true, cuts: "4" }, error: null });
    expect((await requestSegmentation(4, pageTexts)).cuts).toBe("4");

    // 后端连这个字段都没回时是 undefined，不是 []（少一处掩码）
    h.results.push({ data: { success: true }, error: null });
    expect((await requestSegmentation(4, pageTexts)).cuts).toBeUndefined();
  });
});

describe("requestSegmentation —— rejected 的收口", () => {
  it("缺 reason 的条目、非对象条目一律丢掉；page 归一成「有限数字或 null」；evidence 只在是字符串时带上", async () => {
    h.results.push({
      data: {
        success: true,
        cuts: [],
        evidence: [],
        rawCuts: [],
        rejected: [
          // 非对象
          null,
          "x",
          42,
          // 缺 reason / 空 reason
          {},
          { page: 4 },
          { page: 4, reason: "" },
          // page 不是有限数字 ⇒ null（NaN / Infinity 的 JSON 是 "null"，本地不归一就两种形状）
          { page: "4", reason: "page-one" },
          { page: NaN, reason: "not-integer" },
          { page: Infinity, reason: "out-of-range" },
          { reason: "no-evidence", page: null },
          // page 是有限数字就原样带上（4.5 正是「为什么被丢」的一部分）
          { page: 4.5, reason: "not-integer" },
          // evidence 不是字符串 ⇒ 不带这个字段（而不是带一个 null）
          { page: 4, reason: "evidence-unsupported", evidence: 123 },
          { page: 4, reason: "evidence-unsupported", evidence: "Corno II in F" },
        ],
      },
      error: null,
    });

    const res = await requestSegmentation(4, pageTexts);

    expect(res.rejected).toEqual([
      { page: null, reason: "page-one" },
      { page: null, reason: "not-integer" },
      { page: null, reason: "out-of-range" },
      { page: null, reason: "no-evidence" },
      { page: 4.5, reason: "not-integer" },
      { page: 4, reason: "evidence-unsupported" },
      { page: 4, reason: "evidence-unsupported", evidence: "Corno II in F" },
    ]);
  });

  it("**缺字段 ⇒ `rawCuts` 是 `undefined`**（不是 `[]`）：老后端 / 老响应不抛，也不冒充「后端回了」", async () => {
    // 完全没带这两个字段（= 未部署新后端）。⚠️ 这一条**必须**用 `toBeUndefined` 钉住：
    // 界面（`components/seg-evidence.tsx`）据此才敢说「后端没回这两个字段，分不开」——
    // 这里一旦补 `?? []`，界面就会把「不知道」说成「后端回了、里面是空的」，那是一句**假话**，
    // 而这条分界线恰恰是 pkuso-backend#96 §3.2 这两个字段存在的全部理由。
    h.results.push({ data: { success: true, cuts: [4] }, error: null });
    const missing = await requestSegmentation(4, pageTexts);
    expect(missing.rawCuts).toBeUndefined();
    expect(missing.evidence).toBeUndefined();
    expect(missing.cuts).toEqual([4]);
    // `rejected` 缺字段归一成 `[]` 无所谓（没有它时不显示任何「丢掉了几个」的结论）
    expect(missing.rejected).toEqual([]);

    // 回了这个字段、**里面是空的** ⇒ 空数组。这一条与上面那条必须不同形 —— 两者在
    // 改动前长得一模一样（都只有空的 `cuts`），而那正是「分不开」的根源。
    h.results.push({ data: { success: true, cuts: [], rawCuts: [], rejected: [] }, error: null });
    const abstain = await requestSegmentation(4, pageTexts);
    expect(abstain.rawCuts).toEqual([]);
    expect(abstain.rawCuts).not.toBeUndefined();
    expect(abstain.rawCuts).not.toEqual(missing.rawCuts);

    // 带了但形状不对：一律当没带（`undefined`），而不是当空数组
    h.results.push({
      data: { success: true, cuts: [4], rawCuts: "4", rejected: "x" },
      error: null,
    });
    const wrongType = await requestSegmentation(4, pageTexts);
    expect(wrongType.rawCuts).toBeUndefined();
    expect(wrongType.rejected).toEqual([]);

    h.results.push({
      data: { success: true, cuts: [4], rawCuts: null, rejected: {} },
      error: null,
    });
    const wrongType2 = await requestSegmentation(4, pageTexts);
    expect(wrongType2.rawCuts).toBeUndefined();
    expect(wrongType2.rejected).toEqual([]);
  });
});

describe("requestSegmentation —— 失败路径（不许被改动碰坏）", () => {
  it("传输层 error ⇒ 抛错并带上 invokeErrorDetail 的文案", async () => {
    h.results.push({ data: null, error: { message: "boom" } });
    await expect(requestSegmentation(4, pageTexts)).rejects.toThrow("分段请求失败: boom");
  });

  it("success: false ⇒ 抛错，文案优先取 error、退回 message、再退回「未知错误」", async () => {
    h.results.push({ data: { success: false, error: "没有权限" }, error: null });
    await expect(requestSegmentation(4, pageTexts)).rejects.toThrow("分段失败: 没有权限");

    h.results.push({ data: { success: false, message: "模型超时" }, error: null });
    await expect(requestSegmentation(4, pageTexts)).rejects.toThrow("分段失败: 模型超时");

    h.results.push({ data: { success: false }, error: null });
    await expect(requestSegmentation(4, pageTexts)).rejects.toThrow("分段失败: 未知错误");
  });
});
