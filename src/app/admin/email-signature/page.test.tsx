/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import EmailSignaturePage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";
import { EMAIL_SIGNATURE_KEY } from "@/lib/email-signature";

/**
 * `/admin/email-signature` 与 `/api/admin/settings` 的读写接线（Issue #369）。
 *
 * 修前这一页**两头都坏**，而且两个 bug 叠在一起才是完整的故障形态：
 *
 * | 方向 | 修前 | 后果 |
 * | --- | --- | --- |
 * | 读 | 取 `result.value`，而接口回的是**键值映射** | textarea 恒为空 |
 * | 写 | 只发 `{ value }`，漏 `key` | 服务端第一道校验必然 400「无效的设置键」 |
 *
 * 所以「只补 key」的修法会把「存不上」换成**静默清掉已有签名**：页面显示空
 * ⇒ 用户以为没设置 ⇒ 点保存 ⇒ 服务端拿到 `value==""` 走删键路径。
 * 下面每组用例都同时钉住「发对了」和「读对了」。
 */

/** 非空、且**不等于** `DEFAULT_EMAIL_SIGNATURE` 的已有签名。
 *  不这么选夹具的话，「读错键 ⇒ 空串」与「读不到就回落默认签名」这两种错误实现
 *  可能给出与期望值相同的输出，用例就没有鉴别力了。 */
const EXISTING = "北京大学学生交响乐团 · 排练通知组";

const mocks = vi.hoisted(() => ({
  /** `null` = 登录态失效（`getFreshAccessToken` 的失败形态） */
  token: "test-token" as string | null,
  /** ① GET 的响应体：**键值映射**，与 `/api/admin/settings` 的 `Object.fromEntries(...)` 同形 */
  settings: {} as Record<string, unknown>,
  /** ② GET / PUT 的成败开关 */
  getOk: true,
  putOk: true,
  putError: "保存失败",
  getError: "网络异常",
  /** 每次 fetch 的实参 —— 「请求体里到底有没有 key」的判据只在这里 */
  requests: [] as { url: string; method: string; body: Record<string, unknown> }[],
}));

vi.mock("@/lib/auth-token", () => ({
  getFreshAccessToken: vi.fn(async () => mocks.token),
}));

const originalFetch = global.fetch;

function installFetch() {
  mocks.requests.length = 0;
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    mocks.requests.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return {
      ok: method === "PUT" ? mocks.putOk : mocks.getOk,
      // 失败时给 `{ error }`：页面的错误文案就是从这里取的（给 `{ success: true }`
      // 会让「后端拒绝」那条用例只验到兜底文案，验不到后端真正说什么）
      json: async () =>
        method === "PUT"
          ? mocks.putOk
            ? { success: true }
            : { error: mocks.putError }
          : mocks.getOk
            ? mocks.settings
            : { error: mocks.getError },
    };
  }) as unknown as typeof fetch;
}

const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: "保存" });
const putRequests = () => mocks.requests.filter((r) => r.method === "PUT");
const getRequests = () => mocks.requests.filter((r) => r.method === "GET");

/** 渲染并等到首屏 GET 落地（textarea 出现即表示加载态结束）。 */
async function renderLoaded(signature: string | null = EXISTING) {
  mocks.settings = {
    // ⚠️ 模板键**必须排在 `EMAIL_SIGNATURE_KEY` 之前**：响应里多一个键本身不足以
    // 拦住「取第一个值」那类错误实现，那样实现恰好取到的还是正确的那一个
    //（字符串键按插入序）。把顺序调过来，`Object.values(result)[0]` 才是别的键。
    email_template_full_subject: "[PKUSO合排通知] {location}",
    [EMAIL_SIGNATURE_KEY]: signature,
  };
  renderWithProviders(<EmailSignaturePage />);
  await waitFor(() => expect(textarea()).toBeTruthy());
}

describe("/admin/email-signature：读（GET 返回的是键值映射）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = "test-token";
    mocks.getOk = true;
    mocks.putOk = true;
    installFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("打开页面时 textarea 显示服务端**已有**的签名", async () => {
    // 修前这里是 `result.value ?? ""` ⇒ 恒为空串。期望值非空 ⇒ 修前必红。
    await renderLoaded();
    await waitFor(() => expect(textarea().value).toBe(EXISTING));
    expect(EXISTING).not.toBe("");
    // 读的端点也要钉住：只验「值对不对」的话，换成一个形状不同的端点、
    // mock 照旧回这份响应，用例照样绿。
    expect(getRequests()[0]?.url).toBe("/api/admin/settings");
  });

  it("该键为 null（从未设置过）时显示空串，不是 `undefined` 之类的字面量", async () => {
    // 修后走的是 `?? ""` 那一支：值必须真的是空串，否则 textarea 会显示 "undefined"。
    await renderLoaded(null);
    await waitFor(() => expect(textarea().value).toBe(""));
  });

  it("加载失败后点「重试」成功：表单出现，且**不**残留上一次的错误文案", async () => {
    // 失败过之后表单是按 `sigError && sigValue === ""` 藏起来的，而重试一成功
    // `sigValue` 立刻非空 ⇒ 表单渲染出来。若成功路径不清 `sigError`，
    // 页面上会同时挂着**读到的真签名**和一句「加载失败：网络异常」。
    mocks.getOk = false;
    renderWithProviders(<EmailSignaturePage />);
    await waitFor(() => expect(screen.getByText("重试")).toBeTruthy());

    mocks.getOk = true;
    mocks.settings = { [EMAIL_SIGNATURE_KEY]: EXISTING };
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => expect(textarea().value).toBe(EXISTING));

    expect(screen.queryByText(/网络异常/)).toBeNull();
  });
});

describe("/admin/email-signature：写（PUT 必须带 key）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = "test-token";
    mocks.getOk = true;
    mocks.putOk = true;
    installFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("保存把 key 与 textarea 里的当前值一起发出去", async () => {
    await renderLoaded();

    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("签名已保存")).toBeTruthy());

    // ⚠️ 判据是**整个请求体**，不是「有没有 key」这一项：漏 key 会 400，
    // 而值被写空会静默删掉键 —— 两种都要在这一行红。
    expect(putRequests()).toHaveLength(1);
    expect(putRequests()[0].url).toBe("/api/admin/settings");
    expect(putRequests()[0].body).toEqual({ key: EMAIL_SIGNATURE_KEY, value: EXISTING });
  });

  it("发出去的是**编辑后**的内容，且按 trim 处理", async () => {
    await renderLoaded();

    fireEvent.change(textarea(), { target: { value: "  新的落款\n第二行  " } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("签名已保存")).toBeTruthy());

    expect(putRequests()[0].body).toEqual({
      key: EMAIL_SIGNATURE_KEY,
      value: "新的落款\n第二行",
    });
  });

  it('清空后保存：请求体是 `value: ""`（服务端据此删键），页面仍报成功', async () => {
    // 服务端对空值的语义是「让这个键不存在」（#368 的结论）。
    // 注意这条**不是**在验「读坏了也不清签名」—— 那件事由上面「保存的是当前值」那条守住：
    // 读坏了 textarea 就是空的，保存自然发空值。
    await renderLoaded();

    fireEvent.change(textarea(), { target: { value: "   " } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("签名已保存")).toBeTruthy());

    expect(putRequests()[0].body).toEqual({ key: EMAIL_SIGNATURE_KEY, value: "" });
    expect(textarea().value).toBe("");
  });

  it("后端拒绝时显示后端文案，且**不**显示「签名已保存」", async () => {
    // 上游用例断言「显示成功」：没有这一条，把所有响应都当成功也能过。
    mocks.putOk = false;
    mocks.putError = "无效的设置键";
    await renderLoaded();

    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("无效的设置键")).toBeTruthy());
    expect(screen.queryByText("签名已保存")).toBeNull();
  });

  it("拿不到 token 时不发 PUT，提示重新登录", async () => {
    await renderLoaded();

    mocks.token = null; // 令牌在读取之后失效
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("登录状态异常，请重新登录")).toBeTruthy());

    expect(putRequests()).toEqual([]);
    expect(screen.queryByText("签名已保存")).toBeNull();
  });

  it("连点两次只发一次 PUT", async () => {
    // ⚠️ 这条钉的是**行为**（两次点击 ⇒ 一次写），不是 `sigSubmittingRef` 这一个机制：
    // 只删 ref 那一半、留着 `disabled={sigSubmitting}` 时它照样绿（按钮已 disabled，
    // 事件到不了 handler）。两道 guard 都拆掉才会红 —— 别把它当成「ref guard 被测过」。
    await renderLoaded();

    // 同一个节点连点两次：第一次点击之后按钮文案变成「保存中…」，
    // 不能再用 `saveButton()` 去查（那会抛「找不到名为 保存 的按钮」，与要钉的行为无关）
    const btn = saveButton();
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("签名已保存")).toBeTruthy());

    expect(putRequests()).toHaveLength(1);
  });
});
