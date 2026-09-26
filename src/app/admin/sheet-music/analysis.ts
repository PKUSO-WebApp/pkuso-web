import { supabase } from "@/lib/supabase";
import { OTHER_INSTRUMENT_GROUP } from "@/constants/instruments";
import { invokeErrorDetail } from "./ocr-client";
import { normalizeExtraSections } from "./sections";
import { overSubPartsCap, sanitizeSubParts } from "./sub-parts";
import type { LlmAnalysis, PageAttempt } from "./upload-modal.types";

// 取 45s 是为了**盖住后端的重试预算**：后端最坏 = 4 次尝试 × 8s 单次上限 + 退避
// 7s（1+2+4）= 39s。前端若比它短，最后一次尝试的结果就没人读 —— 用户看到的是笼统的
// 「LLM 请求失败（AbortError）」，而不是后端算出来的准确原因（「上游请求失败（…）」
// 或「上游响应无法解析（HTTP 500）」）。45s 给 6s 余量。
// 正常一次 LLM 调用只要 2~5s，这只在上游持续故障时才走到；最坏单文件
// ≈ OCR 65s + LLM 45s，批量耗时因此变长，但分析途中关掉弹窗即可中止（cancelledRef，
// 最坏再多做已在飞的那 PIPELINE_CONCURRENCY 个，见 `upload-modal.tsx`）。
export const LLM_TIMEOUT_MS = 45000;

/**
 * 分析阶段最多看几页（**含**空白页）。
 *
 * 早先叫 `MAX_BLANK_PAGES_TRIED`，只用来跳过出版社分谱常见的空白扉页。总谱分析把这个数
 * 扩成了两个含义 —— 「最多跳几页空白」与「最多升几页」—— 因为两者现在是**同一个循环**
 * （见 `pdf-render.ts` 的 `renderPagesForAnalysis`），一个上界同时管住它们。
 *
 * 它也是**配额上界**：每页最多 `MAX_OCR_IMAGES_PER_PAGE` 次 OCR（标题区 + 整页）。改大它
 * 等于改一份文件的最坏成本，界面上的数字（`estimateAnalysisOcrCalls`）跟着变。
 */
export const MAX_PAGES_EXAMINED = 3;

/** 一页最多送两张图给 OCR：标题区一张、整页一张（未裁切时两者是同一张，只送一次） */
const MAX_OCR_IMAGES_PER_PAGE = 2;

/**
 * 一份文件在分析阶段**最多**烧几次 OCR。
 *
 * 这是**上界**，与分段那边「约 N 次」的估算不同 —— 它由几个常量相乘得出、不依赖语料，
 * 所以可以写成确定的数。真实值通常是 1（第 1 页就读出乐器），扉页起排的总谱是 2~3。
 */
const MAX_ANALYSIS_OCR_PER_FILE = MAX_OCR_IMAGES_PER_PAGE;

const MAX_ANALYSIS_OCR_PER_FILE_ESCALATED = MAX_PAGES_EXAMINED * MAX_OCR_IMAGES_PER_PAGE;

/**
 * 一批文件在**分析阶段**最多烧几次 OCR —— 点火前给用户看的那个数。
 *
 * ⚠️ 与 `segmentation.ts` 的 `estimateOcrCalls` / `estimateTotalOcrCalls` **不是一回事**：
 * 那两个算的是**分段**的成本、报的是「约 N 次」（每页窄带多大要渲染完才知道，估不准）；
 * 这个只由上面的常量相乘得出、不依赖语料，所以报的是**确定的上界**。
 */
export function estimateAnalysisOcrCalls(fileCount: number, escalate: boolean): number {
  if (!Number.isSafeInteger(fileCount) || fileCount < 1) return 0;
  return fileCount * (escalate ? MAX_ANALYSIS_OCR_PER_FILE_ESCALATED : MAX_ANALYSIS_OCR_PER_FILE);
}

/**
 * 这一页要试哪几张图、按什么顺序试。
 *
 * 顺序是**固定**的：标题区在前、整页在后 —— 绝大多数分谱的乐器名就在首页标题区，
 * 先试它才能把典型情况压到 1 次 OCR。而**未裁切时两张图是同一张**（乐谱页的谱线在页顶，
 * `decideTitleCrop` 因「too-thin」不裁），这时只送一次，靠「只有 `cropped` 才追加整页」
 * 这条保证；`base64` 为空（渲染失败 / 拿不到 2D 上下文）则一张都不试。
 *
 * 抽成纯函数是为了能测：升级链的**成本与正确性都压在这个顺序上**，而它一行注释说不清。
 */
export function pageAttempts(page: {
  base64: string;
  fullBase64: string;
  cropped: boolean;
  cropNote: string;
}): PageAttempt[] {
  if (!page.base64) return [];
  const title: PageAttempt = { base64: page.base64, full: false, note: page.cropNote };
  if (!page.cropped) return [title];
  return [
    title,
    { base64: page.fullBase64, full: true, note: `${page.cropNote}｜回退项：改用整页` },
  ];
}

/**
 * 模型这次的结果算不算「定了」—— **升级链走不走下一页全看它**。
 *
 * 判据是「给出了乐器」。**总谱也算定了**：后端判总谱时同时写 `isFullScore` 与
 * `instrument = 总谱`，所以正常情况只看前一项就够；两个都写上是因为**漏判的代价不对称**
 * —— 万一将来后端只置 `isFullScore` 不填 instrument，只看 instrument 会让升级链一路走到
 * 最后一页、白烧 6 次配额才罢休，而多写这一个词没有代价。
 */
export function analysisSettled(a: { instrument: string; isFullScore: boolean }): boolean {
  return a.isFullScore || Boolean(a.instrument);
}

/**
 * 乐器识别：文件名作为**一条证据**，和 OCR 文本一起交给 LLM。
 * 出版社扫描分谱的乐器名往往就写在文件名里（`PMLASIA01165-13-Horn_2.pdf`），而它们的
 * 页面常是扫描乐谱、OCR 读出来是乱的 —— 这种情况下文件名比 OCR 可靠得多。
 *
 * 两个字段**分开发**（pkuso-web#300）：以前文件名是拼进 `ocr_text` 第一行的，那样后端
 * 判「引文在原文里找到」时会把文件名也算成原文（抄文件名、甚至只抄文件名里的流水号
 * 都能让 `evidenceFound` 为真）。
 *
 * @param fileName 文件名，或 **`null` = 不发这一行**。
 *
 * ⚠️ **段级识别一律传 `null`**（2026-09-25 改）。段行继承的是**源合订本**的文件名，
 * 它描述的是**整本**、不代表这一段 —— 而 prompt 规则 8 明写「文件名是 `Flute 1-2`
 * 这种就写 `[1,2]`」，于是**每一段**都会被填成源行那份号，盖过页眉上真正写着的那一行。
 * 后果不是「号不准」而已：各段算出的下载名会撞在一起，`duplicatedInGroup`（在
 * `upload-modal.tsx`）命中后**整组都传不上去**（见 pkuso-web#304）。
 *
 * 整份调用照旧发文件名 —— 对**单份**分谱它常常是最可靠的线索。
 */
export async function runLlmAnalysis(
  fileName: string | null,
  ocrText: string,
): Promise<LlmAnalysis> {
  const { data, error } = await supabase.functions.invoke("llm-analyze", {
    // ⚠️ **文件名单独一个字段**（pkuso-web#300）：以前把它拼进 `ocr_text` 的第一行，
    // 于是后端判「引文在原文里找到」时**把文件名也算成原文** —— 抄文件名、甚至只抄
    // 文件名里的流水号都能让 `evidenceFound` 为真，而那个字段是「让用户复核」的唯一依据
    // （实测 36 次调用里 2 次是这种情形）。
    //
    // 段级调用（`fileName === null`）**不发 `file_name`**（`ocr_text` 照发）—— 那条路本来
    // 就没有文件名（段行继承的是源合订本的名字，见 `upload-modal.tsx` 的 `refineSegments`）。
    body: {
      ...(fileName ? { file_name: fileName } : {}),
      ocr_text: ocrText,
    },
    timeout: LLM_TIMEOUT_MS,
  });
  if (error) {
    throw new Error(`LLM 请求失败: ${await invokeErrorDetail(error)}`);
  }
  if (data?.success) {
    // 响应字段平铺在顶层。`instrument` 为空串即「未识别」。
    // ⚠️ **2026-09-25 起空串只剩两种来源**：模型自己说不知道（prompt 规则 3），
    // 或响应不可用（形状类）。此前「证据不足」也走这条路，后端已改成**照样采用**
    // 并给 `evidenceFound` 信号 —— 所以别再把它当成「后端弃权」的同义词。
    return {
      section: String(data.section ?? OTHER_INSTRUMENT_GROUP),
      instrument: String(data.instrument ?? ""),
      subParts: sanitizeSubParts(data.subParts),
      // 「模型给了号但没读懂」的信号，原样带过来给界面提示用户手填
      subPartsRaw: typeof data.subPartsRaw === "string" ? data.subPartsRaw : undefined,
      // 声部漂移信号（`sectionRaw`）与弃权原因（`abstainReason`）：都是**可选**字段，
      // 缺失 → undefined → 界面不显示（口径见 `LlmAnalysis` 的 docblock「为什么这些字段都写成可选」）。
      // ⚠️ 这两个字段此前**一个消费者都没有**（pkuso-web#302）—— 后端为「把静默差异
      // 变成可见信号」专门发了它们，没人读就等于不存在。
      sectionRaw: typeof data.sectionRaw === "string" ? data.sectionRaw : undefined,
      abstainReason: typeof data.abstainReason === "string" ? data.abstainReason : undefined,
      // 超上界时 sanitize 会把号整个丢掉，而这条路径**不带任何其他信号** ——
      // 不单独报的话它就是一条完全静默的丢号路径（见 overSubPartsCap）
      subPartsOverCap: overSubPartsCap(data.subParts) ?? undefined,
      // 与后端同一条判据：只有恰好 true 才算总谱（`=== true` 而不是真值判断 —— 响应是 any，
      // 字符串 "true" / 1 都不该被当成总谱）。字段缺失时是 undefined → false。
      isFullScore: data.isFullScore === true,
      // 字段缺失 → undefined → 清洗后是 `[]` → 这一行照旧只落一个声部。
      // ⚠️ 这里「缺席」与「空」同义 —— 这是**按设计**成立的（`LlmAnalysis` 的 docblock
      // 「为什么这些字段都写成可选」），靠 `normalizeExtraSections` 兜住而不是靠调用点。
      // 别处不能照抄这个写法（`evidence` 那条正好相反：缺字段 ≠ 空串）。
      // 这是 pkuso-backend#15（subParts 契约 + sub_parts 列）那次「必须同批上线」的教训：
      // 只在新字段的**读的一侧**兜底是不够的，还得保证「缺席」与「空」同义。
      extraSections: normalizeExtraSections(String(data.section ?? ""), data.extraSections),
      // 引文与「有没有在原文里找到」：两者一起显示给用户复核（见 `upload-modal.tsx` 的 `evidenceLine`）。
      // `typeof` 判型而不是 `??` —— 缺字段与空串在界面上**不等价**（前者什么都不显示，
      // 后者要提示「模型没给引文」），**这不是兼容层**，别顺手改成 `?? ""`。
      evidence: typeof data.evidence === "string" ? data.evidence : undefined,
      evidenceFound: typeof data.evidenceFound === "boolean" ? data.evidenceFound : undefined,
      // 引文**只在文件名里**找得到（`Analysis.evidenceFromFileName`，2026-09-26 新增）。
      // 字段缺失 → undefined → 不进「来自文件名」那一支 —— 落到 `evidenceFound` 决定的那两句
      // 之一（所以「`evidence` 非空 + `evidenceFound === false` + 缺这个字段」显示的是警示那一句，
      // 口径见 `upload-modal.types.ts` 的 `LlmAnalysis.evidenceFromFileName`；
      // `evidence` 是空串时会更早返回「模型没给引文」）。
      evidenceFromFileName:
        typeof data.evidenceFromFileName === "boolean" ? data.evidenceFromFileName : undefined,
    };
  }
  throw new Error(`LLM 分析失败: ${data?.error || data?.message || "未知错误"}`);
}
