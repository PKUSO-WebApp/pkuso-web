import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeErrorDetail, invokeOcr, runOcr } from "./ocr-client";

/**
 * `ocr-client` 此前**零测试**，而它正好坐在几个「只会静默出错」的陷阱上
 * （`AGENTS.md` 的谱务设计陷阱清单里那条「`functions.invoke` 吞错」）。
 * 这里钉的是**判据**，不是实现细节：
 *
 * 1. `success: true` 但一个字都没读到 ⇒ **返回空串、不抛错** —— 调用方靠它触发
 *    「回退整页」，抛错会让最常见的那种裁切错位走不到回退分支。
 * 2. `success: false` ⇒ 抛错且**不重试**（这张图本来就没字，重试是浪费）。
 * 3. 瞬时错误（5xx / 超时 / 网络断）⇒ 重试；非瞬时（4xx/权限）⇒ 一次就抛。
 * 4. 服务端报错**不许被吞**：`error.context` 里挂的 Response body 必须出现在文案里。
 * 5. 超时/网络失败的**真实原因**在 `context` 上而不是 `error.message`（supabase-js 把
 *    两者都包成固定文案），不读它就分不出「超时」和「断网」。
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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 跑一个必定要重试（或走完退避）的调用：用假定时器把退避跳过去 */
async function settle<T>(p: Promise<T>): Promise<T> {
  // 先挂一个空处理器：拒绝发生在**定时器回调那一轮**，而真正的 await 要等
  // `runAllTimersAsync` 返回之后才附上 —— 中间那一段 Node 会把它报成
  // unhandled rejection（用例本身不失败，但 vitest 会报错、CI 也会难看）。
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

describe("invokeOcr —— 成功路径", () => {
  it("success 为真时返回 text，并把 overlay 与超时透传给函数", async () => {
    h.results.push({
      data: { success: true, text: "第一小提琴", pages: [{ lines: [{ top: 3, text: "a" }] }] },
      error: null,
    });

    const out = await invokeOcr("AAAA", { overlay: true, what: "首页图" });

    expect(out.text).toBe("第一小提琴");
    expect(out.lines).toEqual([{ top: 3, text: "a" }]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe("ocr-analyze");
    expect(h.calls[0].body.overlay).toBe(true);
    expect(h.calls[0].timeout).toBe(20000);
  });

  it("不传 overlay 时不带上这个字段（上游据此决定回不回坐标）", async () => {
    h.results.push({ data: { success: true, text: "x" }, error: null });
    await invokeOcr("AAAA", { what: "首页图" });
    expect("overlay" in h.calls[0].body).toBe(false);
  });

  it("upstreamHasOverlay 只有显式 true 才算真", async () => {
    h.results.push({ data: { success: true, text: "x", pages: [{}] }, error: null });
    expect((await invokeOcr("AAAA", { what: "拼图" })).upstreamHasOverlay).toBe(false);

    h.results.push({
      data: { success: true, text: "x", pages: [{ upstreamHasOverlay: true }] },
      error: null,
    });
    expect((await invokeOcr("AAAA", { what: "拼图" })).upstreamHasOverlay).toBe(true);
  });

  it("success 为真但一个字都没读到 ⇒ 返回空串，**不抛错**（靠它触发回退整页）", async () => {
    h.results.push({ data: { success: true, text: "" }, error: null });

    const out = await invokeOcr("AAAA", { what: "首页图" });

    expect(out.text).toBe("");
    expect(h.calls).toHaveLength(1); // 也不重试
  });

  it("lines 缺失或不是数组时给空数组（调用方不必再判 undefined）", async () => {
    h.results.push({ data: { success: true, text: "x" }, error: null });
    expect((await invokeOcr("AAAA", { what: "首页图" })).lines).toEqual([]);

    h.results.push({
      data: { success: true, text: "x", pages: [{ lines: "不是数组" }] },
      error: null,
    });
    expect((await invokeOcr("AAAA", { what: "首页图" })).lines).toEqual([]);
  });

  it("lines 的字段缺一个也补成可用的形状（top → Number，text → String）", async () => {
    h.results.push({
      data: { success: true, text: "x", pages: [{ lines: [{ top: "7" }, { text: 12 }] }] },
      error: null,
    });
    expect((await invokeOcr("AAAA", { what: "拼图" })).lines).toEqual([
      { top: 7, text: "" },
      { top: NaN, text: "12" },
    ]);
  });

  it("runOcr 只取 text", async () => {
    h.results.push({ data: { success: true, text: "木琴" }, error: null });
    await expect(runOcr("AAAA")).resolves.toBe("木琴");
  });
});

describe("invokeOcr —— 失败与重试", () => {
  it("success 为假 ⇒ 抛错，且**不重试**", async () => {
    h.results.push({ data: { success: false }, error: null });

    await expect(invokeOcr("AAAA", { what: "首页图" })).rejects.toThrow(/OCR 未识别到文字/);
    expect(h.calls).toHaveLength(1);
  });

  it("瞬时错误（HTTP 502）重试后成功", async () => {
    h.results.push({
      data: null,
      error: { context: new Response("bad gateway", { status: 502 }) },
    });
    h.results.push({ data: { success: true, text: "ok" }, error: null });

    const p = invokeOcr("AAAA", { what: "首页图" });
    await expect(settle(p)).resolves.toMatchObject({ text: "ok" });
    expect(h.calls).toHaveLength(2);
  });

  it("两次退避都用满：第 3 次才成功", async () => {
    h.results.push({ data: null, error: { context: new Response("", { status: 503 }) } });
    h.results.push({ data: null, error: { context: new Response("", { status: 503 }) } });
    h.results.push({ data: { success: true, text: "ok" }, error: null });

    await expect(settle(invokeOcr("AAAA", { what: "首页图" }))).resolves.toMatchObject({
      text: "ok",
    });
    expect(h.calls).toHaveLength(3);
  });

  it("瞬时错误一直失败 ⇒ 抛错（尝试次数 = 1 + 退避条数）", async () => {
    h.results.push({ data: null, error: { context: new Response("", { status: 500 }) } });
    h.results.push({ data: null, error: { context: new Response("", { status: 500 }) } });
    h.results.push({ data: null, error: { context: new Response("", { status: 500 }) } });

    const p = invokeOcr("AAAA", { what: "首页图" });
    await expect(settle(p)).rejects.toThrow(/OCR 请求失败（首页图/);
    expect(h.calls).toHaveLength(3);
  });

  it("非瞬时错误（400）一次就抛，不浪费时间重试", async () => {
    h.results.push({
      data: null,
      error: { context: new Response(JSON.stringify({ error: "没有权限" }), { status: 400 }) },
    });

    await expect(invokeOcr("AAAA", { what: "首页图" })).rejects.toThrow(/没有权限（HTTP 400）/);
    expect(h.calls).toHaveLength(1);
  });

  it("报错文案带上体积，便于对着 OCR.space 的限制排查", async () => {
    h.results.push({ data: null, error: { context: new Response("nope", { status: 400 }) } });
    // 4000 个 base64 字符 = 3000 字节 = 2.9KB
    await expect(invokeOcr("A".repeat(4000), { what: "首页图" })).rejects.toThrow(/首页图 2\.9KB/);
  });

  it("超时/网络失败的真实原因在 context 上，判据要认得出并重试", async () => {
    // supabase-js 把超时与网络失败都包成固定文案的 FunctionsFetchError，
    // 真正的原因（AbortError）挂在 context 上且**不是** Response 实例。
    h.results.push({
      data: null,
      error: { name: "FunctionsFetchError", context: { name: "AbortError" } },
    });
    h.results.push({ data: { success: true, text: "ok" }, error: null });

    await expect(settle(invokeOcr("AAAA", { what: "首页图" }))).resolves.toMatchObject({
      text: "ok",
    });
    expect(h.calls).toHaveLength(2);
  });
});

describe("invokeErrorDetail —— 不吞服务端的报错", () => {
  it("context 是 Response(JSON) ⇒ 带出 body 里的 error 与状态码", async () => {
    const err = {
      context: new Response(JSON.stringify({ error: "base64 太大" }), { status: 413 }),
    };
    await expect(invokeErrorDetail(err)).resolves.toBe("base64 太大（HTTP 413）");
  });

  it("body 不是 JSON ⇒ 退回纯文本", async () => {
    const err = { context: new Response("Bad Gateway", { status: 502 }) };
    await expect(invokeErrorDetail(err)).resolves.toBe("Bad Gateway（HTTP 502）");
  });

  it("body 为空 ⇒ 只报状态码", async () => {
    const err = { context: new Response(null, { status: 500 }) };
    await expect(invokeErrorDetail(err)).resolves.toBe("HTTP 500");
  });

  it("context 不是 Response 的宿主对象（超时）⇒ 把 name/message 压进文案", async () => {
    await expect(
      invokeErrorDetail({ message: "x", context: { name: "AbortError", message: "aborted" } }),
    ).resolves.toBe("x（AbortError: aborted）");
  });

  it("宿主对象只有 name 也要能用", async () => {
    await expect(
      invokeErrorDetail({ message: "x", context: { name: "TimeoutError" } }),
    ).resolves.toBe("x（TimeoutError）");
  });

  it("没有 context / context 是 Response 之外的空值 ⇒ 不加括号后缀", async () => {
    await expect(invokeErrorDetail(new Error("boom"))).resolves.toBe("boom");
    await expect(invokeErrorDetail({ message: "boom", context: null })).resolves.toBe("boom");
  });

  it("「看着像 Error 的纯对象」不能退化成 [object Object]（写这组用例时发现的洞，已修）", async () => {
    // 原实现是 `error instanceof Error ? error.message : String(error)` ——
    // 纯对象走后者，得到 `[object Object]`，把原话吞掉。
    await expect(invokeErrorDetail({ message: "boom" })).resolves.toBe("boom");
  });

  it("message 为空串时退回 String(error)（空串同样不携带信息）", async () => {
    await expect(invokeErrorDetail({ message: "" })).resolves.toBe("[object Object]");
    await expect(invokeErrorDetail({})).resolves.toBe("[object Object]");
  });

  it("不是 Error 的东西也能压成字符串", async () => {
    await expect(invokeErrorDetail("挂了")).resolves.toBe("挂了");
  });
});
