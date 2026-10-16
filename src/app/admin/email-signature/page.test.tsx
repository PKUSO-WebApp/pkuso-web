/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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
 *
 * ⚠️ 本文件给 `@/lib/email-signature` 装了「**改名世界**」（`vi.mock` 的工厂把键名换成
 * `email_signature_renamed`、默认签名换成一个夹具值）：这一页的读与写**本来**就都只认那个
 * 常量，所以夹具与期望值一律跟着常量走、不写死真实键名。它挡的不是今天的 bug，而是同一类
 * **回归** —— 谁把键名抄成字面量，夹具里的键就对不上、用例立刻红；而在真世界里「常量 ==
 * 字面量」的**同值拷贝不可分**：任何「值渲染对了吗」的用例在两种实现下输出都一样。
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
  /** 非 `null` 时该方法（GET / PUT）的响应体挂在这道闸门上，由用例决定何时放行 ——
   *  「读晚于写落地」「写还在飞时读落地」这类时序只有在能控制落地顺序时才可复现。 */
  gates: {} as Partial<Record<"GET" | "PUT", { promise: Promise<unknown> }>>,
  /** 被放行的挂起响应**真的把响应体交回页面**的次数，按方法记 —— 下面「值没被改回去 /
   *  文案还在」的负向断言要它作证：读压根没落地时，那些断言同样成立。 */
  released: [] as string[],
}));

vi.mock("@/lib/auth-token", () => ({
  getFreshAccessToken: vi.fn(async () => mocks.token),
}));

// ⚠️ 只改**值**、不改用法：这一页若「跟随常量」，读写的键名就是改名后的那个。
vi.mock("@/lib/email-signature", () => ({
  EMAIL_SIGNATURE_KEY: "email_signature_renamed",
  EMAIL_SIGNATURE_MAX_LENGTH: 500,
  DEFAULT_EMAIL_SIGNATURE: "默认签名（改名世界）",
}));

const originalFetch = global.fetch;

function installFetch() {
  mocks.requests.length = 0;
  mocks.released.length = 0;
  mocks.gates = {};
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    mocks.requests.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    const gate = mocks.gates[method as "GET" | "PUT"];
    return {
      ok: method === "PUT" ? mocks.putOk : mocks.getOk,
      // 失败时给 `{ error }`：页面的错误文案就是从这里取的（给 `{ success: true }`
      // 会让「后端拒绝」那条用例只验到兜底文案，验不到后端真正说什么）
      json: async () => {
        if (gate) {
          const body = await gate.promise;
          mocks.released.push(method);
          return body;
        }
        return method === "PUT"
          ? mocks.putOk
            ? { success: true }
            : { error: mocks.putError }
          : mocks.getOk
            ? mocks.settings
            : { error: mocks.getError };
      },
    };
  }) as unknown as typeof fetch;
}

const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: "保存" });
const resetButton = () => screen.getByRole("button", { name: "重置" });
const putRequests = () => mocks.requests.filter((r) => r.method === "PUT");
const getRequests = () => mocks.requests.filter((r) => r.method === "GET");

/** 闸门：让某个方法的响应体停在「尚未交回页面」处，由用例决定何时放行。 */
type Gate = { release: (body: unknown) => void };

function armGate(method: "GET" | "PUT"): Gate {
  let release!: (body: unknown) => void;
  const promise = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  mocks.gates[method] = { promise };
  return { release };
}

/** 点「重置」并等到它的 GET **真的上路**（请求已记录、卡在闸门上）。保存必须在读
 *  已经在飞之后才起手，否则测的不是「读晚于写落地」这个竞态，只是两次不相干的调用。 */
async function holdResetRead(): Promise<Gate> {
  const gate = armGate("GET");
  const before = getRequests().length;
  fireEvent.click(resetButton());
  await waitFor(() => expect(getRequests().length).toBe(before + 1));
  return gate;
}

/** 放行一道闸门，并等到页面**跑完**这次响应（`released` 记账 + 一轮宏任务）。
 *  `expectedReleased` 是「到这一刻为止真的落地了哪几次挂起响应」—— 负向断言
 *  （值没被改回去 / 文案还在）只有在读确实落地过时才说明问题。 */
async function releaseGate(gate: Gate, body: unknown, expectedReleased: string[]) {
  await act(async () => {
    gate.release(body);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mocks.released).toEqual(expectedReleased);
}

/** 渲染并等到首屏 GET 落地（textarea 出现即表示加载态结束）。 */
async function renderLoaded(signature: string | null = EXISTING) {
  mocks.settings = {
    // ⚠️ 签名键**夹在**两个模板键中间：响应里多一个键本身拦不住「取第一个值」/「取最后
    // 一个值」那类错误实现 —— 签名键排在最前或最后时，它们恰好取到的还是正确的那一个
    //（字符串键按插入序）。夹到中间，两头取到的都是别的键。
    email_template_full_subject: "[PKUSO合排通知] {location}",
    [EMAIL_SIGNATURE_KEY]: signature,
    email_template_full_body: "<p>正文</p>",
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

/**
 * 读与写对 textarea 的归属（#388 的遗留项，issue #369 的续）。
 *
 * `sigFetchSeqRef` 原来只保护**读-读**：保存起手不 `++seq` ⇒ 一次在飞的读可以**晚于写**
 * 落地，把刚保存的值、或保存失败的文案盖掉。三个表现是同一根因：
 *
 * | 时序 | 后果 |
 * | --- | --- |
 * | 读到的旧值盖掉保存结果 | 页面显示服务端旧值，却挂着「签名已保存」 |
 * | 读成功路径的 `setSigError(null)` 擦掉失败文案 | 保存失败了，页面上没有任何提示 |
 * | 同上，擦掉「登录状态异常，请重新登录」 | 保存根本没发出去，用户以为存上了 |
 *
 * 复现要能**控制落地顺序**，所以给 GET 装了闸门：先让「重置」的读上路并挂住、再点保存、
 * 最后才放行那次读。保存必须在读之后才起手（`holdResetRead` 等到请求发出）——否则测的
 * 就不是竞态，只是两次不相干的调用。
 *
 * 落地窗口不止一个：读落在写**成功之后**、写**失败之后**、以及写**仍在飞**时（用 PUT 的
 * 闸门把写卡住；闸门挂在**响应体**上）。最后那一格钉的是「作废必须早于写**把响应读完**」：
 * 把 `++seq` 挪到 `await res.json()` 之后的修法要红在这一格与「无 token」那格；挪到
 * `await fetch(PUT)` 刚返回之后的修法只有「无 token」那格红（那一格由它兜住）。
 */
describe("/admin/email-signature：读与写的时序（写起手后在飞的读整体作废）", () => {
  const EDITED = "用户在文本框里改过的落款";

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

  it("保存成功后晚到的读不得把值改回去，也不得留下与内容不符的「签名已保存」", async () => {
    await renderLoaded();
    fireEvent.change(textarea(), { target: { value: EDITED } });

    const gate = await holdResetRead();
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("签名已保存")).toBeTruthy());
    expect(putRequests()[0].body).toEqual({ key: EMAIL_SIGNATURE_KEY, value: EDITED });

    // 服务端此刻回的仍是读起手时的旧值 —— 读现在就落地
    await releaseGate(gate, { [EMAIL_SIGNATURE_KEY]: EXISTING }, ["GET"]);

    expect(textarea().value).toBe(EDITED); // ← 修前这里被改回 EXISTING
    expect(screen.getByText("签名已保存")).toBeTruthy();

    // 正向同伴：这条守卫不是「读永远不生效」—— 之后一次**最新**的读照样把值读进来
    mocks.gates = {};
    fireEvent.click(resetButton());
    await waitFor(() => expect(textarea().value).toBe(EXISTING));
  });

  it("保存失败后晚到的读不得把错误文案擦掉", async () => {
    mocks.putOk = false;
    mocks.putError = "服务器开小差了";
    await renderLoaded();
    fireEvent.change(textarea(), { target: { value: EDITED } });

    const gate = await holdResetRead();
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("服务器开小差了")).toBeTruthy());

    await releaseGate(gate, { [EMAIL_SIGNATURE_KEY]: EXISTING }, ["GET"]);

    // ← 修前：读成功路径那句 `setSigError(null)` 会把文案抹掉，页面上一个失败反馈都不剩
    expect(screen.getByText("服务器开小差了")).toBeTruthy();
    expect(textarea().value).toBe(EDITED);
  });

  it("保存因无 token 被拒时，提示不得被晚到的读擦掉（序号要在取 token 之前 +1）", async () => {
    await renderLoaded();
    fireEvent.change(textarea(), { target: { value: EDITED } });

    const gate = await holdResetRead(); // 这次读已经拿到 token 上路了
    mocks.token = null; // 令牌此刻失效
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("登录状态异常，请重新登录")).toBeTruthy());
    expect(putRequests()).toEqual([]); // 同伴：确实走的是「没发 PUT」那条分支

    await releaseGate(gate, { [EMAIL_SIGNATURE_KEY]: EXISTING }, ["GET"]);

    // ↑ 放行前若没作废这次读，它的成功路径会清掉 `sigError`
    expect(screen.getByText("登录状态异常，请重新登录")).toBeTruthy();
  });

  it("写**仍在飞**时落地的读同样被作废（作废发生在 PUT 上路之前，不是等写回来）", async () => {
    await renderLoaded();
    fireEvent.change(textarea(), { target: { value: EDITED } });

    const readGate = await holdResetRead();
    const putGate = armGate("PUT"); // 把写卡在「已发出、尚未回来」
    fireEvent.click(saveButton());
    await waitFor(() => expect(putRequests()).toHaveLength(1));

    await releaseGate(readGate, { [EMAIL_SIGNATURE_KEY]: EXISTING }, ["GET"]);
    // ⚠️ 断言必须在**写回来之前**看：等写落地之后，写自己的 `setSigValue(trimmed)` 会把
    // 值改回正确的那个 ⇒ 只验终态的用例在这一格也是绿的，鉴别力全丢。
    expect(textarea().value).toBe(EDITED); // ← 修前这里闪回 EXISTING

    await releaseGate(putGate, { success: true }, ["GET", "PUT"]);
    await waitFor(() => expect(screen.getByText("签名已保存")).toBeTruthy());
    expect(textarea().value).toBe(EDITED);
    expect(putRequests()[0].body).toEqual({ key: EMAIL_SIGNATURE_KEY, value: EDITED });
  });
});
