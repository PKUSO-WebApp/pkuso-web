/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import EmailSettingsPage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";
import {
  EMAIL_TEMPLATE_FULL_BODY_KEY,
  EMAIL_TEMPLATE_FULL_SUBJECT_KEY,
  EMAIL_TEMPLATE_SECTION_BODY_KEY,
  EMAIL_TEMPLATE_SECTION_SUBJECT_KEY,
} from "@/lib/email-template";

/**
 * `/admin/email-settings` 读设置时的键名（#388 的遗留项，issue #369 的续）。
 *
 * 缺陷形态：**同一条键名两份拷贝** —— 写走常量 `EMAIL_SIGNATURE_KEY`
 * （`saveSetting(EMAIL_SIGNATURE_KEY, signature)`），读走字面量 `result.email_signature`。
 * 两份拷贝当前**值相同**，所以这个缺陷在正常运行下**不可分**：任何「把服务端的值渲染出来」
 * 的用例，两种实现给出的结果都一模一样。要让「跟随常量」与「抄字面量」分开，就得让共享
 * 常量**取一个不同的值** —— 本文件用 `vi.mock` 的工厂把它换成 `email_signature_renamed`，
 * 夹具里的响应体只带改名后的键（这正是真改名之后服务端会返回的形状）。抄字面量那份
 * 读到 `undefined ?? ""` ⇒ textarea 空白 ⇒ 用例红。
 *
 * 改名不是假想：`src/__tests__/notify.test.ts` 专门钉着「键名 == 旧值」那几行，说明改名
 * 是一件会被认真执行的事 —— 而改的人会更新那些钉子，这一页的字面量不会跟着变。
 */

const mocks = vi.hoisted(() => ({
  /** 「共享常量改了值」的那个世界：与旧值 `email_signature` 不同的键名。 */
  RENAMED_KEY: "email_signature_renamed",
  /** 同一世界里的默认签名（用来证明期望值既不是空串、也不是兜底值）。 */
  MOCK_DEFAULT: "默认签名（改名世界）",
  /** 夹具里的签名：非空、且不等于兜底值，否则「读错键 ⇒ 空串」与「读不到就回落默认值」
   *  这两种错误实现会给出与期望值相同的输出。 */
  signature: "北京大学学生交响乐团 · 排练通知组",
  /** `null` = 登录态失效（`getFreshAccessToken` 的失败形态） */
  token: "test-token" as string | null,
  /** GET 的响应体：**键值映射**，与 `/api/admin/settings` 的 `Object.fromEntries(...)` 同形 */
  settings: {} as Record<string, unknown>,
  getOk: true,
  putOk: true,
  putError: "保存失败",
  /** 每次 fetch 的实参 ——「请求体里到底带了哪个 key」的判据只在这里 */
  requests: [] as { url: string; method: string; body: Record<string, unknown> }[],
}));

vi.mock("@/lib/auth-token", () => ({
  getFreshAccessToken: vi.fn(async () => mocks.token),
}));

// ⚠️ 只改**值**、不改用法：这一页若「跟随常量」，读到的就是改名后的键。
vi.mock("@/lib/email-signature", () => ({
  EMAIL_SIGNATURE_KEY: mocks.RENAMED_KEY,
  EMAIL_SIGNATURE_MAX_LENGTH: 500,
  DEFAULT_EMAIL_SIGNATURE: mocks.MOCK_DEFAULT,
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
      json: async () =>
        method === "PUT"
          ? mocks.putOk
            ? { success: true }
            : { error: mocks.putError }
          : mocks.getOk
            ? mocks.settings
            : { error: "加载失败" },
    };
  }) as unknown as typeof fetch;
}

/** GET 的响应体：**键值映射**，与 `/api/admin/settings` 的 `Object.fromEntries(...)` 同形。
 *  `null` 是「这个键从未设置过」的形态 —— 服务端在 `Object.fromEntries` 之前把缺的键补成 null。 */
function settingsPayload(signature: string | null): Record<string, unknown> {
  return {
    // ⚠️ 签名键**夹在**模板键中间：夹具里多一个键本身拦不住「取第一个值」/「取最后一个值」
    // 那类错误实现 —— 签名键排在最前或最后时，它们恰好取到的还是正确的那一个（字符串键
    // 按插入序）。夹到中间，两头取到的都是模板键。
    [EMAIL_TEMPLATE_FULL_SUBJECT_KEY]: "[PKUSO合排通知] {title}",
    [EMAIL_TEMPLATE_FULL_BODY_KEY]: "<p>合排正文</p>",
    [mocks.RENAMED_KEY]: signature,
    [EMAIL_TEMPLATE_SECTION_SUBJECT_KEY]: "[PKUSO分排通知] {title}",
    [EMAIL_TEMPLATE_SECTION_BODY_KEY]: "<p>分排正文</p>",
  };
}

const getRequests = () => mocks.requests.filter((r) => r.method === "GET");
const putRequests = () => mocks.requests.filter((r) => r.method === "PUT");
const signatureTab = () => screen.getByRole("button", { name: "邮件签名" });
const saveButton = () => screen.getByRole("button", { name: "保存" });
const signatureBox = () =>
  screen.getByPlaceholderText("如：北京大学学生交响乐团") as HTMLTextAreaElement;

/** 渲染并等到首屏 GET 落地（「加载中…」消失即表示加载态结束）。 */
async function renderLoaded() {
  renderWithProviders(<EmailSettingsPage />);
  await waitFor(() => expect(screen.queryByText("加载中…")).toBeNull());
}

describe("/admin/email-settings：读写的键名都取自共用常量", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = "test-token";
    mocks.getOk = true;
    mocks.putOk = true;
    mocks.settings = settingsPayload(mocks.signature);
    installFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("「邮件签名」分栏显示的是**共享常量那个键**上的值，不是字面量那个键", async () => {
    // 修前这里是 `result.email_signature` ⇒ 改名世界里读到 `undefined ?? ""` ⇒ 期望值落空。
    await renderLoaded();
    fireEvent.click(signatureTab());
    await waitFor(() => expect(signatureBox().value).toBe(mocks.signature));
    expect(mocks.signature).not.toBe("");
    expect(mocks.signature).not.toBe(mocks.MOCK_DEFAULT);
    // 读的端点也钉住：只验「值对不对」的话，换成别的端点、mock 照旧回这份响应照样绿。
    expect(getRequests()[0]?.url).toBe("/api/admin/settings");
  });

  it("保存签名时请求体的 key 也是共享常量当前的值", async () => {
    await renderLoaded();
    fireEvent.click(signatureTab());
    await waitFor(() => expect(signatureBox().value).toBe(mocks.signature));

    fireEvent.change(signatureBox(), { target: { value: "新的落款" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());

    expect(putRequests()).toHaveLength(1);
    expect(putRequests()[0].url).toBe("/api/admin/settings");
    expect(putRequests()[0].body).toEqual({ key: mocks.RENAMED_KEY, value: "新的落款" });
  });

  it("该键为 null（从未设置过）时显示空框、保存发的是空值，而不是崩在 null 上", async () => {
    // 服务端对「没有这一行」的键补 `null`（`route.ts` 在 `Object.fromEntries` 之前填充），
    // 所以「从未设置过」传到这里就是 null。少了那行 `?? ""`，textarea 的 value 是 null，
    // 保存时值的 `.trim()` 当场抛 TypeError ⇒ 页面只剩一句内部报错、**一个 PUT 都不发**。
    // ⚠️ 判别力在下面**保存**那两条断言上：React 把 `value={null}` 也渲染成空框，所以
    // 「显示空框」这一条在删掉 `?? ""` 的变异下照样绿，别把它算成「显示」那一半的覆盖。
    mocks.settings = settingsPayload(null);
    await renderLoaded();
    fireEvent.click(signatureTab());
    await waitFor(() => expect(signatureBox().value).toBe(""));

    fireEvent.click(saveButton());
    await waitFor(() => expect(putRequests()).toHaveLength(1));

    expect(putRequests()[0].url).toBe("/api/admin/settings");
    expect(putRequests()[0].body).toEqual({ key: mocks.RENAMED_KEY, value: "" });
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());
  });
});
