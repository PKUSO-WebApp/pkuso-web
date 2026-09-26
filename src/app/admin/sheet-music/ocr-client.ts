import { supabase } from "@/lib/supabase";

// 单次调用的超时（毫秒）。OCR 链路三段（前端 → 边缘函数 → OCR.space）都没有超时，
// 客户端不给上限的话，任何一段挂住都会让 await 永不 settle：重试逻辑没机会触发、
// UI 一直转圈且不报错。（这个缺陷最初由一次探针脚本挂死 4 分 43 秒暴露。）
// 取 20s 而非更长：超时是可重试的，单张图最坏 = 20s×3 次 + 退避 4.7s ≈ 65s。
// 实测正常 OCR 只要 2~4s，20s 已是 5~10 倍余量；给到 45s 会让 20 个文件的最坏
// 耗时逼近 45 分钟，而弹窗目前没有取消入口。
const OCR_TIMEOUT_MS = 20000;
// OCR.space 偶发 E502/E503 之类服务端引擎错误（实测 33 次里出现 1 次），重试即可。
// 注意只写 "Failed to fetch" 是不够的：supabase-js 会把网络错误与超时统一包成
// FunctionsFetchError，其 message 恒为「Failed to send a request to the Edge Function」，
// 原话里没有 "Failed to fetch"，那条分支永远不会命中 —— 超时和网络失败都不会重试。
const OCR_RETRY_DELAYS = [1200, 3500];
const OCR_TRANSIENT =
  /E5\d\d|HTTP 5\d\d|timeout|timed out|Failed to fetch|Failed to send a request|AbortError/i;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Edge Function 返回非 2xx 时，functions.invoke 会返回 { data: null, error }，
 * 真实错误体挂在 error.context（Response）上——不读它就会把服务端的报错吞掉。
 */
/** 把 context 上挂的原始错误（AbortError / DOMException 等）压成一句可读原因 */
function describeCause(ctx: unknown): string {
  if (ctx == null || ctx instanceof Response) return "";
  // 用结构化判断（读 name/message）而不是 `instanceof Error`：这里要处理的是
  // AbortError / DOMException 这类宿主对象。实测（真 Chrome）
  // `new DOMException("x","AbortError") instanceof Error === true`，所以 instanceof
  // 今天也能work —— 但结构化判断不依赖原型链，跨 realm（iframe/worker）或被
  // polyfill / 打包改写时更稳，也能容忍只有 name 没有 message 的对象。
  const name = (ctx as { name?: unknown }).name;
  const message = (ctx as { message?: unknown }).message;
  if (typeof name !== "string" || !name) return "";
  return `（${name}${typeof message === "string" && message ? `: ${message}` : ""}）`;
}

export async function invokeErrorDetail(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  // supabase-js 在网络失败/超时时会把错误包成 FunctionsFetchError：message 是固定文案
  // 「Failed to send a request to the Edge Function」，真正的原因（AbortError 等）挂在
  // context 上且**不是** Response 实例。不读它就无法区分「超时」和「网络断了」，
  // 下面 OCR_TRANSIENT 的重试判据也匹配不到。
  const cause = describeCause(ctx);
  if (ctx instanceof Response) {
    const status = `HTTP ${ctx.status}`;
    try {
      const body = (await ctx.clone().json()) as { error?: string } | null;
      const detail = body?.error ? body.error : JSON.stringify(body);
      return `${detail}（${status}）${cause}`;
    } catch {
      try {
        const text = await ctx.clone().text();
        return text ? `${text}（${status}）${cause}` : `${status}${cause}`;
      } catch {
        return `${status}${cause}`;
      }
    }
  }
  return (error instanceof Error ? error.message : String(error)) + cause;
}

/** base64 长度换算回实际图片字节数 */
function base64Kb(base64: string): number {
  return Math.round(((base64.length * 3) / 4 / 1024) * 10) / 10;
}

/**
 * 一次 `ocr-analyze` 调用（瞬时错误自动重试），返回**原始载荷**。
 *
 * 拆出这一层是为了让**拼图**那条路复用同一套重试/超时/错误文案 —— 它要多拿
 * `pages[0].lines`（带坐标的行），而首页那条路只要 `text`。
 *
 * `overlay: true` 时上游才会回坐标；`pkuso-backend` 的
 * `supabase/functions/ocr-analyze/shape.ts` 明确说过坐标的**量纲由调用方判定**
 * （见 `mosaic.ts` 的 `mapLinesToPages`），所以这里原样透传，不做任何猜测。
 */
export async function invokeOcr(
  imageBase64: string,
  opts: { overlay?: boolean; what: string },
): Promise<{
  text: string;
  lines: Array<{ top: number; text: string }>;
  upstreamHasOverlay: boolean;
}> {
  const kb = base64Kb(imageBase64);
  let lastError = "";

  for (let attempt = 0; attempt <= OCR_RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await sleep(OCR_RETRY_DELAYS[attempt - 1]);

    const { data, error } = await supabase.functions.invoke("ocr-analyze", {
      body: {
        file_base64: imageBase64,
        mime_type: "image/jpeg",
        ...(opts.overlay ? { overlay: true } : {}),
      },
      timeout: OCR_TIMEOUT_MS,
    });

    if (error) {
      lastError = await invokeErrorDetail(error);
      if (OCR_TRANSIENT.test(lastError) && attempt < OCR_RETRY_DELAYS.length) continue;
      throw new Error(`OCR 请求失败（${opts.what} ${kb}KB）: ${lastError}`);
    }
    // 服务端 200 且 success：即便一个字都没读到也算成功，返回空串。
    // 这里**不能抛错** —— 调用方靠「文本去空白后少于 `MIN_OCR_CHARS` 个字符」触发回退整页，
    // 抛错会让最关键的那种情况（裁切条完全空白）根本走不到回退分支，
    // 而这正是「切错位置」最常见的表现。
    if (data?.success) {
      const lines = Array.isArray(data.pages?.[0]?.lines)
        ? (data.pages[0].lines as Array<{ top?: unknown; text?: unknown }>).map((l) => ({
            top: Number(l.top),
            text: String(l.text ?? ""),
          }))
        : [];
      return {
        text: String(data.text ?? ""),
        lines,
        upstreamHasOverlay: data.pages?.[0]?.upstreamHasOverlay === true,
      };
    }

    // success 为假：这张图确实没有可读文本，重试无意义
    lastError = `服务端 success=${data?.success} 但未返回文字`;
    break;
  }

  throw new Error(`OCR 未识别到文字（${opts.what} ${kb}KB）: ${lastError}`);
}

/** 首页图片交给 ocr-analyze 转发 OCR.space；瞬时错误自动重试，最终失败抛错并带上体积便于排查 */
export async function runOcr(imageBase64: string): Promise<string> {
  return (await invokeOcr(imageBase64, { what: "首页图" })).text;
}
