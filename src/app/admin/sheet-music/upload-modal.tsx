"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Database } from "@/types/database";
import JSZip from "jszip";
import { X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { runWithConcurrency } from "@/lib/concurrency";
import { FULL_SCORE_SECTION } from "@/constants/instruments";
import {
  boundarySpan,
  estimateTotalOcrCalls,
  mergeSegmentIntoPrev,
  moveSegmentStart,
  parseBoundaryText,
  splitSegment,
  startsFromResponse,
} from "./segmentation";
import { fillMissingSubParts, generateFileName } from "./sub-parts";
import { fileTargetsOf, normalizeExtraSections } from "./sections";
import { duplicateNames, openForSplit, splitRefusal } from "./split-pdf";
import type { LlmAnalysis, UploadFile, UploadModalProps, UploadPhase } from "./upload-modal.types";
import {
  analysisSummary,
  describeInsertError,
  editsOf,
  segEligible,
  segmentsOf,
  startTextOf,
  startsOf,
  statusColor,
  statusText,
  unsplitSegments,
  uploadBlocker,
} from "./row-text";
import { renderPagesForAnalysis } from "./pdf-render";
import {
  analysisSettled,
  estimateAnalysisOcrCalls,
  MAX_PAGES_EXAMINED,
  pageAttempts,
  runLlmAnalysis,
} from "./analysis";
import {
  ocrBandsForSegmentation,
  requestSegmentation,
  SegmentationCancelled,
} from "./segmentation-run";
import { runOcr } from "./ocr-client";
import { FooterBar } from "./components/footer-bar";
import { FileRow } from "./components/file-row";

/**
 * 乐器名现在是**开放集**：后端 llm-analyze 直接返回中文（`木琴` / `英国管` /
 * `低音单簧管`…），不再走「英文字典 → 中文」的映射。
 *
 * 原先那张 `INSTRUMENT_CN_MAP` 已删除 —— 它是开放集合的映射，每来一个新乐器就要
 * 加一行，而新乐器是无限的，注定追不上（它把 Bassoon 译成「巴松管」，与项目标准
 * 的「大管」冲突，就是这个割裂的产物）。
 */

/**
 * 存储键：`{scoreId}/{行 id}.pdf`。
 *
 * ⚠️ **不能用声部/乐器名做路径段** —— Supabase Storage 的键只允许
 * 字母数字与 `_ - . ' , ! * & $ @ = ; : + ? ( )` 和空白，**中日韩字符一律被
 * 拒为 `Invalid key`**（官方文档 *File names restrictions*）。中文名此前一直
 * 写在路径里，所以这个上传功能**从来没有成功过一次**（`sheet_music_files` 长期 0 行
 * 就是这个原因，不是"新功能还没用"）。
 *
 * 人类可读的名字改放 DB：`sheet_music_files.file_name` 与 `.instrument` 两列，
 * 下载时由客户端 `a.download = file_name` 还原文件名（`storage.download(path)`
 * 拿回 blob 后自己触发下载，**不走 `download` 选项**）。用行自己的 id 还顺带让
 * 「两个文件算出同一条路径互相覆盖」由**构造**消失（每个键唯一），不再需要批内查重。
 */
function pathOf(scoreId: string, storageId: string): string {
  return `${scoreId}/${storageId}.pdf`;
}

/**
 * 「同组段重名」的拦截文案。
 *
 * ⚠️ 提成常量是为了**能按值比较**：自动拆完之后各段的号是空的（几秒后段级识别才回来），
 * 用户若在这中间点「确认上传」，就会被这条拦下、红字留在行上；等号各自落地、名字已经
 * 不同了，那句却没人清。段级识别落地时只清**这一种** `error` —— 不能无条件清，
 * 那会把「上传失败」那类红字一起抹掉，用户会以为传上去了。
 */
const DUPLICATE_SEGMENT_ERROR = "与同组的其他段重名，请改乐器名或号";

// OCR 文本去空白后少于这么多字符就当成「没读到」，触发回退整页。
// OCR 偶尔会返回单个字符或纯标点，严格判空会漏掉这种情况。
const MIN_OCR_CHARS = 5;

/**
 * 同时最多有几个文件在飞（分析、上传两段共用）。
 *
 * 批量耗时几乎全在网络等待（OCR 2~4s、LLM 2~5s、上传几 MB 的 PDF），串行时主线程基本闲着；
 * 并发把这些等待叠起来。**CPU 部分不会因此变快** —— 渲染与 JPEG 编码仍在主线程排队
 * （pdf.js 走 fake worker，见 loadPdfJs），并发只是让某个文件的网络往返不再挡着别的文件。
 * 实测（**仓库外**的 `.render-harness/`，与 pkuso-web 同级；33 份真实分谱 + 模拟 6.5s/份网络）：
 * 271s → 108s。
 *
 * 取 3 而不是更大，是因为再往上收益迅速变小：CPU 部分实测约 1.7s/份，3 路时已被网络那侧
 * 盖住；OCR.space 免费档也没必要主动去撞突发限流（后端有 429 重试兜底，但那是兜底）。
 *
 * ⚠️ **内存不是这里的约束，而且别按「份数 × 单份内存」估** —— 早先这版注释就是那么写的，
 * 基数低了约 14 倍。真 Chrome 里逐次记录 canvas 后备存储实测：
 *   - 单份 canvas 峰值可达 **~282MB**（46 份语料里 28 份如此）。其中约 265MB 是 **pdf.js
 *     自己解码那张 1500 DPI 扫描图时开的内部画布**（6467×8609 + 3234×4305），页面自己的
 *     canvas 只有 16MB —— 真正的大头在 pdf.js 里，不在这一层；
 *   - 另有 ~900MB 的 JS 堆瞬时高水位（强制 GC 后回落，不是泄漏）；
 *   - 但 **3 份并发只把它放大 1.02~1.14 倍，不是 3 倍**：那段解码是纯主线程 CPU 活，
 *     在飞的文件在解码段被自排队了。
 * 也就是说「取 3 是安全的」结论成立，但兜住它的是**主线程串行**，不是「每份只花一点内存」。
 * 想把常量调大的人，先看这条。
 */
const PIPELINE_CONCURRENCY = 3;

export function UploadModal({ open, onClose, scoreId, onUploaded }: UploadModalProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [phase, setPhase] = useState<UploadPhase>("select");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  /**
   * 「分析总谱」（#297）：**默认关**。
   *
   * 开着才走多页升级链 —— 一页（标题区 → 整页）读不出乐器时，继续看第 2、第 3 页，
   * 直到出现某个声部或判出总谱。关着时的行为与加它之前**一字不变**（读完第一张有内容的
   * 页就走），那是绝大多数分谱的路径（它们第 1 页上就写着乐器名）。
   *
   * 默认关的理由是成本：开着之后一份文件最坏 6 次 OCR 而不是 1 次，而收益只落在
   * 扉页起排的总谱上 —— 那种谱子在语料里是少数，不该让所有导入替它付账。
   */
  const [analyzeFullScore, setAnalyzeFullScore] = useState(false);
  /**
   * 「乐谱分段」（#297）：**默认开**。
   *
   * 关掉 = 这一批整个跳过分段（一份 116 页的合订谱要烧十几次 OCR）。它是一道**总开关**，
   * 与 `segEligible` 是「与」的关系而不是替代 —— `segPending` 是按钮文案与执行共用的
   * 那一个判据，只在 `segEligible` 里加条件会让两者分叉。
   */
  const [autoSegment, setAutoSegment] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 关闭弹窗会把本组件卸载（page.tsx 把 selectedScoreId 置 null），但 startAnalysis 的
  // 并发池还在跑：updateFile 变成 no-op，用户看不见进度、重开是全新空状态，OCR 配额却照烧 ——
  // 最坏 20 个文件（并发 3、单文件最坏 ≈ OCR 65s + LLM 45s）仍能在后台持续请求十几分钟。
  // 卸载时置位，每个文件开头检查一次后退出（已在飞的那几个会跑完）。
  const cancelledRef = useRef(false);
  // 防重复提交：ref 同步阻断竞态窗口（setState 是异步的，两次快速点击之间 phase 仍是旧值）
  const analyzingRef = useRef(false);
  const segRunningRef = useRef(false);
  /**
   * 正在重试的行下标（逐行重试用）。
   *
   * ⚠️ `analyzingRef` 挡不住它：那个 ref 只由 `startAnalysis` 置位，而 `analyzeOne`
   * 自己不管它 —— 直接调 `analyzeOne` 就绕过去了。连点两次「重试」会起两条流水线写
   * 同一行（最后写赢，但那一份文件的 OCR 烧两次）。
   *
   * 用 `Set<number>` 而不是单个布尔：两行可以各重试各的，互不相干。
   */
  const retryingRef = useRef(new Set<number>());
  // 分段的 state 半（ref 挡重复点击，state 让**别的按钮**知道分段在跑）
  const [segBusy, setSegBusy] = useState(false);
  /**
   * 正在飞的「段级识别」组数。
   *
   * ⚠️ **它落地前不能让用户上传**：`uploadOne` 算 `section/instrument/subParts` 用的是
   * **点击那一刻的闭包行**，而段级识别的写回只被 `status === "done"` 挡住 ——
   * 行还在 `uploading` 时写回照常落地。结果是界面上号已经各就各位、库里那份却是**没号**的
   *（`file_name` 与 `sub_parts` 都定格在识别回来之前），而且行转 `done` 后不会回退、
   * 也没有任何提示。号是下载文件名的来源，所以这是「文件名对不上」那类问题的入口。
   */
  const [refiningCount, setRefiningCount] = useState(0);
  /**
   * 切分前的原行快照（`groupId` → 原行 + 它当时的位置），供「还原为一份」。
   *
   * 用 ref 不用 state：它只是一份**撤销用的底稿**，不参与渲染；放进 state 会让
   * 每次拆分多一次重渲染，而内容一模一样。
   */
  const splitSnapshots = useRef(new Map<string, { row: UploadFile; at: number }>());
  /**
   * `files` 的最新值，供**异步流程**读当前状态。
   *
   * ⚠️ 闭包里的 `files` 是**本次渲染的快照**，而分段/重试这些长任务跑完时它早就过期了。
   * 自动拆行必须按**现在**那一行来拆 —— 用户可能在这几十秒里改了号、改了乐器，
   * 或者把这一行标成「总谱」（= 这一份别拆，见 `needsSegmentation`）；
   * 按点击那一刻的快照硬拆，那些表态会被静默丢掉。
   *
   * ⚠️ 用 **`useLayoutEffect`**（不是 `useEffect`）而不是渲染期赋值：
   * · 渲染期赋值在并发渲染下可能被丢弃（那次渲染根本没提交）；
   * · 被动 `useEffect` 是**调度器 normal 优先级**的任务，输入事件（用户正在打字/选声部）
   *   优先级更高、能插到它前面 —— 于是「用户刚改完、分段刚好收尾」那一拍，
   *   收尾的微任务续体可能读到**编辑前**那一行，正是这里要防的那件事。
   *   layout effect 在提交那一刻同步跑完，之后任何任务读到的都是新值。
   */
  const filesRef = useRef(files);
  useLayoutEffect(() => {
    filesRef.current = files;
  }, [files]);
  const uploadingRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const newFiles: UploadFile[] = [];

    for (const file of selected) {
      if (file.type === "application/pdf") {
        newFiles.push({ file, originalName: file.name, status: "pending" });
      } else if (file.name.endsWith(".zip")) {
        try {
          const zip = await JSZip.loadAsync(file);
          const pdfFiles = Object.keys(zip.files).filter((name) =>
            name.toLowerCase().endsWith(".pdf"),
          );

          for (const pdfName of pdfFiles) {
            const pdfData = await zip.files[pdfName].async("blob");
            const pdfFile = new File([pdfData], pdfName.split("/").pop() || pdfName, {
              type: "application/pdf",
            });
            const baseName = pdfName.split("/").pop() || pdfName;
            newFiles.push({
              file: pdfFile,
              originalName: baseName,
              status: "pending",
            });
          }
        } catch {
          alert(`ZIP 文件解压失败: ${file.name}`);
        }
      }
    }

    setFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateFile = (
    index: number,
    patch: Partial<UploadFile> | ((f: UploadFile) => Partial<UploadFile>),
  ) => {
    setFiles((prev) =>
      prev.map((f, idx) => {
        if (idx !== index) return f;
        // 传函数时可以**按当前值**决定改什么（返回 `{}` 就是不改）——
        // 「异步结果回来时用户已经动过手」这类判断需要它。
        return { ...f, ...(typeof patch === "function" ? patch(f) : patch) };
      }),
    );
  };

  /**
   * 按**存储键**改一行（而不是按下标）。
   *
   * ⚠️ 段行的「各自识别」与逐行重试都是**异步**的，而它们飞行期间用户可能点
   * 「还原为一份」或「确认这 N 段」—— 那两个都会改变 `files` 的长度，下标随之平移，
   * 按下标写就会**写进别的行**（重试那条路径上实测踩过同一个坑，见 `retryRow`）。
   * `storageId` 每行生成一次、终身不变，按它找就与行集变化无关。
   *
   * 行已经不在了（用户还原掉了）就什么都不做 —— 这正是我们要的。
   */
  const updateFileByStorageId = (
    storageId: string,
    patch: Partial<UploadFile> | ((f: UploadFile) => Partial<UploadFile>),
  ) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.storageId !== storageId) return f;
        // ⚠️ **已上传的行不接受晚到的写回**（对抗测试实测）：库里的行与 storage 对象
        // 早就落定了，而段级识别是异步的 —— 让它在 `done` 之后改写，界面会显示一个
        // 与库**不一致**的答案，而 `done` 行不渲染编辑器（那道门是 `analyzed || error`），
        // 用户既看不到差异也无处可改。飞行期间「确认上传」是可点的（`hasAnalyzingFiles`
        // 只看 `status === "analyzing"`，refine 不改 status），所以这个窗口真实存在。
        if (f.status === "done") return f;
        // 传函数时可以**按当前值**决定改什么（返回 `{}` 就是不改）——
        // 「异步结果回来时用户已经动过手」这类判断需要它。
        return { ...f, ...(typeof patch === "function" ? patch(f) : patch) };
      }),
    );
  };

  /**
   * 单个文件：取页 → OCR → LLM，每步只更新自己那一行。
   *
   * files 是点击那一刻的快照，worker 里的 updateFile 不会改到它——只用它决定处理哪些
   * 文件，不要用它判断处理进度（上一版据此判断，导致永远进不了确认阶段）。
   */
  const analyzeOne = async (file: UploadFile, i: number) => {
    // 弹窗被关掉就尽快收手：每个文件开头检查一次，最坏多做已在飞的那几个
    if (cancelledRef.current) return;
    if (file.status !== "pending") return;

    updateFile(i, { status: "analyzing", ocrText: "正在提取页面...", llmResult: "" });

    // 取页与 OCR 都是「能给就给」：失败不终止，退化成只用文件名让 LLM 判断
    let ocrText = "";
    let warning = "";
    let walk: Awaited<ReturnType<typeof renderPagesForAnalysis>> | null = null;
    let analysis: LlmAnalysis | null = null;

    try {
      // 取页 / 渲染 / OCR 的异常都在 `renderPagesForAnalysis` 与 `tryPage` **内部**兜住
      // （那边各自说明了理由），所以这一层 catch 只会接到一种东西：**LLM 失败** ——
      // 那正是「整行失败」的定义，落 `status: "error"` 让用户重试。旧版也是这个分工。
      walk = await renderPagesForAnalysis(file.file, {
        maxPages: MAX_PAGES_EXAMINED,
        // 关掉时「读完第一张有内容的页就走」。与加这个之前相比只剩两处**有意**的差异
        // （渲染失败 / OCR 失败不再整份降级，而是当「这一页没结论」继续）——
        // 清单与理由在下面 `if (!opts.escalate) break` 那里。
        escalate: analyzeFullScore,
        isCancelled: () => cancelledRef.current,

        // 「这一页定没定论」**只在这一个函数里判** —— 升级链走不走下一页全看它返回什么。
        tryPage: async (page) => {
          // 标题区那条失败原因要跨 attempt 留着：两张都失败时得一起报（见下面）
          let titleError = "";

          for (const attempt of pageAttempts(page)) {
            updateFile(i, {
              ocrText: attempt.full
                ? `第 ${page.pageNo} 页标题区未给出结论，回退整页…`
                : `已取第 ${page.pageNo} 页（${page.cropped ? "标题区" : "整页"}），正在 OCR...`,
              // ⚠️ 缩略图、裁切说明、页号**在这一刻就写**，不等 OCR 成功。
              // 这三个字段的唯一用途是排查「切错位置」，而 OCR 读不出正是切错位置的主症状 ——
              // 等到成功才写，等于在最需要它们的时候把它们藏起来（对抗测试实测：两张图
              // 都失败时行里连缩略图都没有，用户看不出到底送了哪张图、裁到哪）。
              // 「与实际送检的那张图一致」这条约束仍然成立：这里写的正是**即将送出去的**那张。
              preview: (attempt.full ? page.fullPreview : page.preview) || undefined,
              cropNote: attempt.note,
              sourcePage: page.pageNo,
            });

            // 服务端表达「没读到文字」有两种形态：200 + 空 text，以及 400 + success:false
            // （见 pkuso-backend 的 ocr-analyze：IsErroredOnProcessing 为真时回 400）——
            // 后者会被 runOcr 抛成异常。只在返回空串时才回退，等于漏掉更常见的那一半，
            // 而「切错位置」恰恰是最容易让裁切条读不到文字的情况。
            //
            // ⚠️ **OCR 的异常就地消化，绝不放出去**：放出去会被上层当成「整份失败」而终止
            // 整个升级链，可「这一页读不出」恰恰是最该换下一页的输入。放出去的另一个代价是
            // 整行落 `error` —— 而 PDF 其实还能用，只是这一页读不出。
            let text = "";
            try {
              text = await runOcr(attempt.base64);
            } catch (err) {
              const why = err instanceof Error ? err.message : String(err);
              if (attempt.full || !page.cropped) {
                // 两张都试过了（或本来就只有一张）：**两条原因都带上** —— 第一条
                // （标题区）往往更有诊断价值，只留最后一条会把「切错位置」这个最常见的
                // 病因吞掉。
                updateFile(i, {
                  ocrText: titleError ? `标题区：${titleError}；整页：${why}` : why,
                });
              } else {
                titleError = why;
                updateFile(i, { ocrText: `第 ${page.pageNo} 页标题区 OCR 失败，回退整页…` });
              }
              continue;
            }

            // ⚠️ **OCR 一成功就记下文本**（而不是等 LLM 成功）：下面的兜底那次调用要用它，
            // 记晚了那次就退化成「只凭文件名」，用户拿到一个没有 OCR 证据的结论且无从分辨。
            ocrText = text;
            updateFile(i, { ocrText: text });

            // 标题区读到的字太少就不值得送 LLM，直接进下一次尝试（同 MIN_OCR_CHARS）
            if (!attempt.full && page.cropped && text.trim().length < MIN_OCR_CHARS) continue;

            updateFile(i, { llmResult: "等待 LLM 分析..." });
            let got: LlmAnalysis;
            try {
              got = await runLlmAnalysis(file.originalName, text);
            } catch (err) {
              // ⚠️ **第一次 LLM 失败才让整行失败**（异常穿出去 → 外层 catch → `error`）。
              // 已经拿到过结论之后，后面这一次失败**不该把已有结果丢掉** ——
              // 旧版的规矩就是这样（回退那次失败只记 warning、保留第一次结果），
              // 而且升级链让它更要紧：第 2 页的 LLM 抖动没道理作废第 1 页的答案。
              // 反过来做还有个更坏的后果：`error` 行在确认阶段既不能重试也不能移除，
              // 是一条死胡同（对抗测试实测），所以绝不能让一次抖动把行推进去。
              if (!analysis) throw err;
              updateFile(i, {
                warning: `第 ${page.pageNo} 页重试失败：${err instanceof Error ? err.message : String(err)}`,
              });
              continue;
            }
            analysis = got;
            // 「定了就停」这条判据只有一份，见 `analysis.ts` 的 `analysisSettled`。
            if (analysisSettled(got)) return true;
            // ⚠️ **这里必须是「继续循环」而不是 `return`**：这一页还剩一张图（整页）没试。
            // 早先写成 `return analysisSettled(got)`（`analysis.ts`），直接退出了整个 attempt 循环 ——
            // 于是「LLM 未识别 → 回退整页」那条回退成了**死代码**（只有「标题区字太少」
            // 或「标题区抛错」才走得到它），而那正是加总谱分析**之前**就有的行为。
          }
          return false;
        },
      });
      warning = walk.warning;
      if (warning) updateFile(i, { warning });
      // 一页有内容的都没取到（全空白 / 渲染失败）：把原因写进 OCR 文本框。
      // 不写的话那里还挂着开工时那句「正在提取页面...」—— 那是进度文案不是结果，
      // 等于在最需要看到底发生了什么时说反话。
      if (!walk.contentPage && warning) updateFile(i, { ocrText: warning });

      // 一页有内容的都没读到（全空白 / 渲染失败 / OCR 读不出 / 读到的字太少）：
      // 退化成只用文件名让 LLM 判断。空串是后端约定的「未识别」，但
      // ⚠️ **2026-09-25 起它只剩两种来源**：模型自己说不知道、或响应不可用。
      // 「证据不足」不再走这一支（后端改成照样采用 + `evidenceFound` 信号）——
      // 别再把空串当成「后端弃权」的同义词（同 `analysis.ts` 的 `runLlmAnalysis` 里那句）。
      if (!analysis) {
        // ⚠️ 关掉弹窗之后**不要再补这一发**：它没有取消检查，而超时是 45s ——
        // 用户明明已经关窗走人，配额还在烧（对抗测试实测：卸载后 llm 调用 0→1，
        // body 里只有文件名）。
        if (cancelledRef.current) return;
        updateFile(i, { llmResult: "等待 LLM 分析..." });
        analysis = await runLlmAnalysis(file.originalName, ocrText);
      }

      const {
        section,
        instrument,
        subParts,
        subPartsRaw,
        subPartsOverCap,
        evidence,
        evidenceFound,
        evidenceFromFileName,
        sectionRaw,
        abstainReason,
        isFullScore,
        extraSections,
      } = analysis;
      // 未识别时**不预填** instrumentEdit（留空串）：预填一个猜测值会被用户直接
      // 接受，等于把错误洗成「已确认」。空的输入框会逼用户做一次真实判断。
      // **总谱**（#297）：模型判出「一页上并列着多个乐器」时，声部直接落「总谱」——
      // 总谱不是声部，而是「整份都在里面」，所以分声部号清空（`editsOf` 在总谱下也
      // 一律当空）；而且 `segEligible` 对总谱恒 false → **它不会再进分段**，
      // 那正是分段里最贵的一笔（总谱今天要靠人工标记，而人工标记只能等分段跑完才做得出）。
      updateFile(i, (cur) => ({
        status: "analyzed",
        // ⚠️ **必须清 `error`**：`updateFile` 是合并（`{...f, ...patch}`），而这一行可能是
        // 从 `error` 重试回来的 —— 不清的话「失败: …」那句红字会挂在一条**已经成功**的
        // 行上，读起来像「重试也没用」。这与三个输入 handler 顺手清 `error` 是同一条理由。
        error: undefined,
        llmResult: isFullScore
          ? "识别结果: 总谱（整份）—— 不参与分段"
          : analysisSummary(section, instrument, subParts),
        sectionGuess: isFullScore ? FULL_SCORE_SECTION : section,
        instrumentGuess: isFullScore ? FULL_SCORE_SECTION : instrument,
        // ⚠️ **Edit 那两个字段是「用户的表态」**（本文件上面写过：一旦动过就属于用户），
        // 而这次分析是**异步**的 —— 用户在这几秒里改过就不许覆盖。
        // `Guess` 照写：界面取 `Edit ?? Guess`，用户没动时正好显示新结果。
        // 判据是「还等于开工时那个值」，也就是他没动过。
        // 跨声部的共用分谱（`Violoncello e Basso` 那种）：这一行上传时要落成几行。
        // 总谱恒为空（`normalizeExtraSections` 里挡掉了），所以这里不用再判 isFullScore。
        // **不写 `extraSectionsEdit`**：`undefined` = 用户没动过 → 界面显示 Guess，
        // 与 section/instrument 那两对「Guess + Edit 都写」不同 —— 那两个的 Edit 是输入框的
        // 初值，而这个字段在界面上是 chip 列表，没有「输入框初值」这回事。
        extraSectionsGuess: extraSections,
        ...(isFullScore ? { subPartsEditText: "" } : {}),
        subPartsGuess: subParts,
        // 不设 subPartsEditText：`undefined` = 没编辑过 → 输入框显示 Guess。
        // 「模型给了号但没读懂」时 subParts 是空数组，输入框自然留空，
        // 配合下面的 subPartsRaw 提示，用户知道这一格需要他填。
        subPartsRaw,
        // ⚠️ 这一行曾经漏掉：`analysis.ts` 的 `runLlmAnalysis` 算出了 overCap、`subPartsNotice` 也写了那一支，
        // 但**中间没人把它写进行状态**，于是那条提示是死代码 —— 上界漂移时号被静默吞掉，
        // 一个字都不显示（审查靠「提示可达性」的探针抓出来的）。三个环节缺一不可。
        subPartsOverCap,
        // 引文与「找没找到」：两者要一起进界面（`evidenceLine`），否则后端那批改动
        // 唯一的补偿信号就断在这里 —— 与 subPartsOverCap 曾经漏写是同一种病。
        // （`evidenceFromFileName` 同理：漏写它，那句「依据来自文件名」就永远不出现。）
        evidence,
        evidenceFound,
        evidenceFromFileName,
        // 声部漂移信号与弃权原因（pkuso-web#302）：与上面那两个漏写是同一种病 ——
        // 上游算了、展示代码也写了那一支，**中间没人把它写进行状态**，于是那是死代码。
        // ⚠️ `undefined` 也要写：重试之后得把上一次的原因清掉。
        sectionRaw,
        abstainReason,
        // 记下页数：成本估算与「这份要不要分段」都看它（多页且非总谱才走分段）
        pageCount: walk?.pageCount,
        // 存储键要在**分析完成时**就定下来（每行一次、重试复用），
        // 而不是每次点上传现生成 —— 否则失败重传会不断产生新对象。
        storageId: crypto.randomUUID(),
        // 「从没动过」的判据是 **Edit 仍等于 Guess** —— 不是「与开工时相同」：
        // 用户在**点重试之前**就选好声部的情形同样要保护（合规审查实测的那个路径）。
        ...(cur.sectionEdit === cur.sectionGuess
          ? { sectionEdit: isFullScore ? FULL_SCORE_SECTION : section }
          : {}),
        ...(cur.instrumentEdit === cur.instrumentGuess
          ? { instrumentEdit: isFullScore ? FULL_SCORE_SECTION : instrument }
          : {}),
      }));
    } catch (err) {
      updateFile(i, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  /**
   * 重试**一行**的分析。服务**两类**行（2026-09-25 起是两类，此前只有第一类）：
   *
   * ① **首次分析就失败**的（`status === "error"` 且 `instrumentGuess === undefined`）。
   *    这种行三处叠加成死胡同（原因本身**看得见** —— 标题行那句 `失败: …` 是红的；
   *    缺的是**能点的东西**）：
   *      · `uploadableCount` 按 `instrumentGuess !== undefined` 计数 → 它不进上传；
   *      · 编辑器与那行红字都在同一道门里 → 整格控件一个都不渲染；
   *      · 移除按钮只在 select 阶段有。
   *    整批都是这种行时，「确认上传」会被禁用 —— 用户唯一的出路是关掉弹窗重加文件，
   *    代价是丢掉整批已经烧掉的 OCR 配额。
   * ② **分析完了但没认出乐器**的（`isUnidentified`，见那边）。它不是死胡同（编辑器是
   *    渲染着的、可上传也会被 `uploadBlocker` 拦），但**用户唯一的动作是手填**；
   *    而同一输入两次结果不同是实测存在的，所以给他一个「再问一次」的出路。
   *
   * ⚠️ **段行（`splitOf` 非空）走的是另一条路**：只重跑**这一段**的识别（用切分时留下的
   * 本段首页文本，0 次 OCR）。跑整份源文件是错的 —— 段行只有 `splitOf.from..to` 那几页，
   * 而整份重跑会把 `pageCount` 覆盖成源文件的页数、还会去渲染不属于该段的页
   *（实测：2 页的段点一次重试变成「未识别（3 页）」，且第 1 页被渲染）。
   *
   * 上传阶段失败的行（有 `instrumentGuess` 的那种）**不走这里**：点「确认上传」就会重传，
   * 那是既有的、有注释说明的重试路，这里再给一个按钮只会让人不知道按哪个。
   */
  const retryRow = async (i: number) => {
    if (retryingRef.current.has(i)) return;
    retryingRef.current.add(i);

    // ⚠️ **段行走另一条路**：只重跑**这一段**的识别（0 次 OCR）。见 docblock 里的实测：
    // 让段行去跑整份源文件会把 `pageCount` 覆盖成源文件页数、还会渲染不属于该段的页。
    const seg = files[i];
    if (seg?.splitOf) {
      try {
        const head = seg.segHeadText?.trim();
        if (!head) {
          updateFile(i, { warning: "这一段没有可用的首页文本（那一页 OCR 没成功）—— 请手填" });
          return;
        }
        // 同 `refineSegments`：段级**不发源文件名**（它描述的是整本，不代表这一段）
        const got = await runLlmAnalysis(null, head);
        const section = got.isFullScore ? FULL_SCORE_SECTION : got.section;
        const instrument = got.isFullScore ? FULL_SCORE_SECTION : got.instrument;
        updateFileByStorageId(seg.storageId ?? "", (cur) => {
          // 同 `refineSegments`：用户已经动过的字段一个字都不覆盖
          if (cur.sectionEdit !== seg.sectionEdit || cur.instrumentEdit !== seg.instrumentEdit) {
            return {};
          }
          return {
            sectionGuess: section,
            sectionEdit: section,
            instrumentGuess: instrument,
            instrumentEdit: instrument,
            extraSectionsGuess: normalizeExtraSections(got.section, got.extraSections),
            llmResult: got.isFullScore
              ? "识别结果: 总谱（整份）—— 不参与分段"
              : analysisSummary(got.section, got.instrument, got.subParts),
            evidence: got.evidence,
            evidenceFound: got.evidenceFound,
            evidenceFromFileName: got.evidenceFromFileName,
            sectionRaw: got.sectionRaw,
            abstainReason: got.abstainReason,
            // 号也一并写回（2026-09-25）：这一段的重试就是为了「上一次没认出来」，
            // 而号同样是段级识别的产物 —— 只更新乐器名、把号留在空上，用户还得手填。
            // ⚠️ **空数组不覆盖**：组级补号（`fillMissingSubParts`）可能已经给这一段
            // 补过一个号，而重试读到空只说明「这次没读出号」，不构成「那个补的号是错的」。
            ...(got.subParts.length > 0
              ? {
                  subPartsGuess: got.subParts,
                  subPartsRaw: got.subPartsRaw,
                  subPartsOverCap: got.subPartsOverCap,
                }
              : {}),
            error: undefined,
            warning: undefined,
          };
        });
      } catch (err) {
        updateFileByStorageId(seg.storageId ?? "", {
          warning: `这一段没能重新识别（${err instanceof Error ? err.message : String(err)}）`,
        });
      } finally {
        retryingRef.current.delete(i);
      }
      return;
    }
    try {
      // 清掉上一次留下的**痕迹**。`updateFile` 是合并，不清就会挂在成功后的行上。
      //
      // ⚠️ **这里不清 `error`** —— 那一条归 `analyzeOne` 的成功 patch 管
      // （它才是「这次分析成功了」的那个判据）。两处都清的话其中一处**永远不承重**，
      // 而变异验证会直接暴露这件事：把成功 patch 里那句删掉，若两边都清则测试全绿 ——
      // 等于那句没被任何用例钉住。清 error 只留一处，且留在知道结论的那一处。
      // 重试**期间**也看不到上一次的错误：行进了 pending/analyzing，`statusText` 是
      // 「待分析 / 分析中…」，而编辑器那道门在 `analyzed || error` 上 —— 三个状态都不显示它。
      //
      // ⚠️ **不清 `pageTexts` / `segState` / `segmentStarts` / `segFailedPages`** ——
      // 那些是分段链路的产物（花过 OCR 买来的），一次「重跑分析」没有理由把它们抹掉；
      // 重试后 `pageCount` 会重新写，分段要不要重跑由既有的 `segPending` 判据决定。
      updateFile(i, {
        status: "pending",
        warning: undefined,
        cropNote: undefined,
        preview: undefined,
        sourcePage: undefined,
        pageCount: undefined,
      });
      // 传一份**状态已改成 pending 的对象**：`analyzeOne` 开头的 `file.status !== "pending"`
      // 读的是传进去的那个对象（闭包快照，见 `analyzeOne` 的说明），而 `files[i]` 此刻
      // 还是 `error`。其余字段（`file` / `originalName`）本来就来自这一行，照传即可。
      await analyzeOne({ ...files[i], status: "pending" }, i);
    } finally {
      retryingRef.current.delete(i);
    }
  };

  const startAnalysis = async () => {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setPhase("analyzing");
    cancelledRef.current = false;

    // 并发跑：每份文件各自走完「取页 → OCR → LLM」，最多 PIPELINE_CONCURRENCY 个同时在飞。
    // 结果乱序完成没关系 —— 每步只按自己的下标 updateFile，互不干扰。
    //
    // 文件之间**不再 sleep**：原先那句「避免 LLM/OCR 限流」是误判 —— 当时那批 429 是
    // ocr-analyze 里 pdf-lib 抽首页爆缓冲区导致的，不是服务端限流；而 OCR 与 LLM 两条
    // 链路本来就各有 429 重试兜底（见 runOcr）。
    try {
      await runWithConcurrency(files, PIPELINE_CONCURRENCY, analyzeOne);
    } catch (err) {
      // 兜底：worker 理论上不抛（每个文件的失败都写进了它自己那一行），真抛了也不能让弹窗
      // 卡在「分析中」—— 「确认上传」会被 hasAnalyzingFiles 永久禁用，用户唯一的出路是
      // 关掉弹窗，而代价是丢掉整批已经烧掉 OCR 配额的分析结果。
      console.error("分析阶段意外中断:", err);
      const message = err instanceof Error ? err.message : String(err);
      setFiles((prev) =>
        prev.map((f) => (f.status === "analyzing" ? { ...f, status: "error", error: message } : f)),
      );
    } finally {
      analyzingRef.current = false;
    }

    if (cancelledRef.current) return;
    setPhase("confirm");
  };

  /**
   * 真正会跑的判据：**总开关开着**、合格、**且还没跑过**。
   *
   * 按钮文案与执行**必须共用这一个** —— 分开写的话，已跑完的份数会被重复计入文案，
   * 而再点一次其实一个调用都不发（用户看到的数与真实会烧的数不是同一个判据）。
   *
   * 「乐谱分段」这道总开关放在**这里**而不是 `segEligible` 里：`segPending` 是按钮文案、
   * 按钮显隐、`runSegmentation` 的取数三处共用的那一个，加在它就是三处一起生效；加在
   * `segEligible` 里则会与 `unsplitSegments`（上传守卫，与 `segEligible` 同源）分叉。
   */
  const segPending = (f: UploadFile) => autoSegment && segEligible(f) && f.segState !== "done";
  const segTargets = files.map((f, i) => ({ f, i })).filter(({ f }) => segPending(f));

  const segCost = estimateTotalOcrCalls(
    segTargets.map(({ f }) => ({
      pageCount: f.pageCount ?? null,
      eligible: true,
      donePages: f.pageTexts?.length ?? 0,
    })),
  );

  /**
   * 跑分段（#290 Step 1）。**不自动跑** —— 一份 N 页的合订谱要烧 N 次 OCR，
   * 用户必须在点火前知道这个数（见 segCost 与界面上的按钮文案）。
   *
   * 切点判出来之后**直接拆成 N 行**（用户 2026-09-25 定）：导入者本来就不想读，
   * 所以主路径上不再需要点「确认这 N 段」。
   *
   * ⚠️ 那个按钮**没有被删掉** —— 它还留在两条路上：`splitRefusal` 拒绝后的后备，
   * 以及用户点过「还原为一份」之后想再拆。删了它那两条路就没有出口了。
   *
   * 拆分放在**这个函数里**而不是渲染期效果 —— 后者会在用户点「还原为一份」之后
   * 立刻再拆一次（死循环）。
   */
  const startSegmentation = async () => {
    if (segRunningRef.current) return;
    segRunningRef.current = true;
    // state 半（与 ref 同步置位）：ref 挡重复点击，state 让**别的按钮**知道分段在跑 ——
    // 分段一次要烧 N 次 OCR、界面要等几十秒，这期间「确认上传」必须禁用，
    // 否则两个长任务重叠，而分段的结果会落到刚上传完、编辑器已隐藏的那一行上。
    setSegBusy(true);
    cancelledRef.current = false;
    /**
     * 待拆的行。**在并发池跑完、循环外的第二趟里才真拆** —— 拆分改变 `files` 的长度，
     * 在池子里拆会让同时飞着的其它任务写错行（同 `retryRow` 那条教训）。
     */
    const toSplit: { i: number; patch: Partial<UploadFile> }[] = [];
    try {
      const targets = files.map((f, i) => ({ f, i })).filter(({ f }) => segPending(f));
      await runWithConcurrency(targets, PIPELINE_CONCURRENCY, async ({ f, i }) => {
        if (cancelledRef.current) return;
        updateFile(i, { segState: "running", segError: undefined });
        try {
          const { pageCount, pageTexts, failedPages } = await ocrBandsForSegmentation(f.file, {
            existing: f.pageTexts,
            isCancelled: () => cancelledRef.current,
          });
          // OCR 的产物**先落状态**：下一步（LLM）失败时它还在，重试只补缺的页
          updateFile(i, { pageTexts, segFailedPages: failedPages });
          const cuts = await requestSegmentation(pageCount, pageTexts);
          // 起点的推导走 segmentation.ts 里那份（校验 cuts 是它存在的理由）。
          // 别在这里内联重写 —— 否则上线跑的是没被测试覆盖的第三份实现。
          const starts = startsFromResponse(cuts, pageCount);
          /**
           * 分段自己产出的那几个字段。
           *
           * ⚠️ **state 侧只能写这几个**。写成整行（`{ ...f, ...segPatch }`）会把点击那一刻的
           * 快照整个合并回去 —— 而窄带 OCR 要跑几十秒，用户完全可能在这期间改了声部/乐器
           *（那两个输入框只判 `phase === "uploading"`，分段期间是可编辑的），
           * 那些手改会被**静默回滚**成模型早先的答案。`updateFile` 是合并语义，
           * patch 里带旧值就是旧值胜出。
           */
          const segPatch = {
            pageTexts,
            segFailedPages: failedPages,
            segState: "done" as const,
            // 段的**起点**（恒含第 1 页）与输入框原文一起写：两者逐位对应，
            // 编辑时下标才不会错位（见 UploadFile.segmentStartText）
            segmentStarts: starts,
            segmentStartText: starts.map(String),
          };
          updateFile(i, segPatch);
          // 只记下标与这几个字段，**不在这里拼整行**：整行要等池子跑完、
          // 从 `filesRef` 里取**当时**那一行再拼 —— 用户可能在这几十秒里改过它（见下面的循环）。
          if (starts.length > 1) toSplit.push({ i, patch: segPatch });
        } catch (err) {
          // 关窗导致的取消不是失败：状态留在那儿就行（重开弹窗本来就是全新状态）
          if (err instanceof SegmentationCancelled) return;
          updateFile(i, {
            segState: "error",
            segError: err instanceof Error ? err.message : String(err),
          });
        }
      });

      // ⚠️ **下标降序**：拆一行会把它后面的行整体后移，从后往前拆才不会让前面待拆的
      // 下标失效。
      //
      // ⚠️ **整行按 `filesRef` 现取**，不用点击那一刻的快照：分段要跑几十秒，用户在这期间
      // 可能改了号、改了乐器、或者把这一行标成「总谱」（= 这一份别拆）。按旧快照硬拆，
      // 那些表态会被静默丢掉 —— 而且不是「影响有界」：段行会继承旧值、补号也会拿旧的号集合
      // 去做减法，用户以为改对的那版反而没生效。
      for (const { i, patch } of [...toSplit].sort((a, b) => b.i - a.i)) {
        if (cancelledRef.current) break;
        const cur = filesRef.current[i];
        if (!cur) continue;
        const fresh: UploadFile = { ...cur, ...patch };
        // 用户可能刚把它标成「总谱」或改成未识别 —— 那两种都不该再拆。
        // 不拆是安全的：`unsplitSegments` 也走 `segEligible`，为假时不会拦上传，
        // 这一行就按整份走（「跑完分段、看段数再标总谱」正是本文件写明的主用法）。
        if (!segEligible(fresh)) continue;
        splitIntoSegments(i, fresh);
      }
    } finally {
      segRunningRef.current = false;
      setSegBusy(false);
    }
  };

  /**
   * 三个只改一段的编辑操作（改起点 / 拆分 / 合并）都走这里。
   *
   * 用**函数式 setState**：这些操作是「读当前状态 → 改一个数组 → 写回」的
   * read-modify-write，用闭包里的 `files[index]` 拼 patch 会在同一 tick 的两次
   * 调用之间丢更新（打字是逐字符触发的，最容易撞上）。
   *
   * `mutate` 返回新数组（或**原引用**表示拒绝修改），`text` 由调用方同步给出：
   * 原文数组必须与起点数组**同一次**更新里改，否则两者长度一旦错开，下标就错位，
   * 用户改的会是**别的段**（而且再也对不回来）。
   */
  const editSegments = (
    index: number,
    mutate: (f: UploadFile) => { starts: number[]; text: string[] } | null,
  ) => {
    setFiles((prev) =>
      prev.map((f, idx) => {
        if (idx !== index) return f;
        const next = mutate(f);
        if (!next) return f;
        return { ...f, segmentStarts: next.starts, segmentStartText: next.text };
      }),
    );
  };

  /**
   * 改输入框原文 —— **只改原文，不提交**。打字过程中的中间态停在这里。
   *
   * ⚠️ 按 `startsOf(f)` 的**长度重建**，而不是 `text[segIndex] = raw` 直接写：
   * 后者在下标越界时会把数组**撑长**（稀疏数组），于是「原文数组与起点数组等长」
   * 这条不变量会从「当场暴露」退化成「静默错位」—— 而错位的后果是用户改的是**别的段**。
   * 重建之后长度由构造保证。
   */
  const setSegmentStartRaw = (index: number, segIndex: number, raw: string) =>
    editSegments(index, (f) => {
      const starts = startsOf(f);
      const text = startTextOf(f);
      return { starts, text: starts.map((_, k) => (k === segIndex ? raw : (text[k] ?? ""))) };
    });

  /**
   * 提交输入框原文（失焦 / 回车）。
   *
   * **非法原文一律不提交**：留在框里（用户看得见自己敲了什么）+ 标红提示范围，
   * 段本身一动不动。绝不走「非法 → 把它过滤掉」那条路 —— 那等于用户敲一个字符
   * 就静默删掉一个边界，而恢复要重跑整个分段。
   *
   * ⚠️ 「失焦/回车才提交」与「`moveSegmentStart` 的区间守卫」是**两道独立的保险**，
   * 都要留着：变异测试实测，把前者改回「每次按键都提交」，全部用例**仍然绿**
   *（中间态 `1` 落在可动区间外，被守卫当场拒绝）—— 也就是说守卫独立挡住了旧 bug。
   * 但反过来不成立：守卫的区间是靠 `boundarySpan` 算的，谁放松了它，
   * 第一道保险就是唯一还站着的那道。
   */
  const commitSegmentStart = (index: number, segIndex: number) =>
    editSegments(index, (f) => {
      const starts = startsOf(f);
      const text = startTextOf(f);
      const span = boundarySpan(starts, segIndex, f.pageCount ?? 1);
      if (!span) return null;
      const v = parseBoundaryText(text[segIndex] ?? "", span.lo, span.hi);
      if (v === null) return null; // 非法：原文留着，段不动
      const moved = moveSegmentStart(starts, segIndex, v, f.pageCount ?? 1);
      if (moved === starts) return null;
      const nextText = [...text];
      nextText[segIndex] = String(moved[segIndex]); // 回写成规范形式（"015" → "15"）
      return { starts: moved, text: nextText };
    });

  /** 删掉这条边界（这一段并进上一段）—— 唯一会让段数变少的操作，必须是显式点击 */
  const mergeSegmentAt = (index: number, segIndex: number) =>
    editSegments(index, (f) => {
      const starts = startsOf(f);
      const next = mergeSegmentIntoPrev(starts, segIndex);
      if (next === starts) return null;
      const text = [...startTextOf(f)];
      text.splice(segIndex, 1);
      return { starts: next, text };
    });

  /**
   * 在这一段里加一条边界（拆成两段）。
   *
   * 后端刻意「宁可少切，不可多切」，所以**模型漏切是常态** —— 没有这个按钮，
   * 用户唯一的出路就是重跑分段（再烧 N 次 OCR），而那还不一定能切得更好。
   */
  const splitSegmentAt = (index: number, segIndex: number) =>
    editSegments(index, (f) => {
      const starts = startsOf(f);
      const next = splitSegment(starts, segIndex, f.pageCount ?? 1);
      if (next === starts) return null;
      const text = [...startTextOf(f)];
      text.splice(segIndex + 1, 0, String(next[segIndex + 1]));
      return { starts: next, text };
    });

  /**
   * **按段拆成多行**（#290 Step 2 的入口）。
   *
   * 拆完之后每一段各占一行、各有各的声部/乐器/号，文件名各自生成（`圆号1.pdf`），
   * 上传时源文件只读一次、逐段切出来各传各的。
   *
   * 号**不在这里定**（2026-09-25 改）。原先按「第 k 段 ↔ 第 k 个号」预填，依据是
   * **文件名里的号数与段数相等** —— 而文件名可能什么有用信息都没有，也可能像
   * `…--_Piccolo,_Flute_1,_2.pdf` 那样同时印着多件乐器，于是**每一段**都被填成
   * `[1,2]`（长笛 1 那段与长笛 2 那段因此撞成同一个文件名、整组被上传拦下）。
   * 号一律由**各段自己的首页文本**识别得出（见 `refineSegments`），读不到时再由
   * `fillMissingSubParts` 用其它段做减法补。
   *
   * @param freshRow **刚由 `startSegmentation` 写进状态的那一行**，自动拆那条路必须传。
   *   `files` 是本次渲染的闭包快照，`updateFile` 刚写进去的值在这里**还读不到**：
   *   · 少了 `segmentStarts` → 读到的是空的旧段起点，等于没拆；
   *   · 少了 `pageTexts` → **第一次**跑分段时它还是 `undefined`，于是每段的
   *     `segHeadText` 都取不到、段级识别整批不跑（号全空）；
   *   · 快照（「还原为一份」用的）也会是旧的，用户还原后得重跑一次 OCR。
   *   传整行而不是零散字段，这三处就都自动是对的。
   */
  const splitIntoSegments = (index: number, freshRow?: UploadFile) => {
    const f = freshRow ?? files[index];
    const segments = segmentsOf(f);
    if (segments.length < 2) return;
    const refusal = splitRefusal({
      byteSize: f.file.size,
      pageCount: f.pageCount ?? 0,
      segTotal: segments.length,
    });
    if (refusal) {
      // 拦在这里而不是等到上传：切分是**显式动作**，用户点之前就该知道它不成立
      updateFile(index, { error: refusal });
      return;
    }

    const groupId = crypto.randomUUID();

    const rows: UploadFile[] = segments.map((seg, k) => ({
      // 源文件**共用同一个 File 对象**（不可变）：上传时按 groupId 只 load 一次
      file: f.file,
      originalName: f.originalName,
      status: "analyzed",
      sectionGuess: f.sectionGuess,
      sectionEdit: f.sectionEdit,
      instrumentGuess: f.instrumentGuess,
      instrumentEdit: f.instrumentEdit,
      // ⚠️ **诊断字段刻意不继承源行**（与 `subPartsRaw` / `extraSections` 同一类决定）：
      // 它们陈述的是「**这一次**识别怎么回答的」，而拆完段之后每一段都会各识别一次 ——
      // 继承来的值只在这几秒的窗口里可见，随后就被这一段自己的答案覆盖（写回里成对写），
      // 而那个窗口里用户什么也做不了。所以「源行那次漂移」随源行一起消失，不留到段上。
      // 号一律留空起手，由各段**自己的首页文本**识别得出（见 `refineSegments`）——
      // 不继承源行的号，也不按位置预填，理由见上面 `splitIntoSegments` 的 docblock。
      subPartsGuess: [],
      // ⚠️ **不继承 `subPartsRaw`**：源行那句「模型给了号但没读懂」是对**整份**说的，
      // 继承下去会让**每一段**的 `subPartsUnread` 为真 → 每段都被 `uploadBlocker`
      // 拦下（连用户没做错什么的那几段一起）。段自己没读出号时，由段级识别
      // 自己带上 `subPartsRaw`。
      // ⚠️ **刻意不继承 `extraSections`**（源行是跨声部共用分谱时它非空）——
      // 这不是漏写的字段。切分的目的就是让**每一段各归各的声部**：源行那句
      // 「还落到低音提琴」是对**整份**的判断，拆开之后对任何单独一段都不再成立，
      // 用户会逐段确认自己该归哪儿（预填的 sectionEdit 就是干这个的）。
      //
      // 反过来「顺手补上」会坏掉：两段的行级主名都预填自源行（都叫 `大提琴.pdf`），
      // 于是 `duplicatedInGroup` 判定同组重名、**把整组的上传拦下**，报一句
      // 「与同组的其他段重名，请改乐器名或号」—— 而用户根本没做错什么，
      // 改名字也解不开（改的是主名，额外落点那份仍在）。
      //
      // ⚠️ `duplicatedInGroup` 现在仍只看**行级**那一个名字，看不出「一行会展开成多个文件」。
      // 已知的漏网形态：手工给某一段加了额外声部，而那个额外声部正是另一段的主声部
      // —— 但这要求用户先拆一份共用分谱（本来就自相矛盾）再手工补，现实里很边缘。
      // 没顺手改它，是因为那要连带处理「不同源文件之间也会同名」这个**既有**的更宽缺口，
      // 属另一件事。
      pageCount: seg.to - seg.from + 1,
      // 本段**自己首页**的窄带文本 —— 切完立刻用它各识别一次（见 `refineSegments`）。
      // 取不到（那一页 OCR 失败）时是 undefined，那一段就保留继承来的判断。
      segHeadText: f.pageTexts?.find((p) => p.page === seg.from)?.text,
      // 每段一个存储键：重试覆盖的是**这一段自己**，不会串到别的段
      storageId: crypto.randomUUID(),
      splitOf: {
        groupId,
        from: seg.from,
        to: seg.to,
        segIndex: k,
        segTotal: segments.length,
      },
      // 分析阶段的调试信息只挂在第 1 段上：4 份重复的 OCR 文本/预览图没有意义
      ...(k === 0
        ? { ocrText: f.ocrText, preview: f.preview, cropNote: f.cropNote, warning: f.warning }
        : {}),
    }));

    // 快照留给「还原为一份」：拆错了要能退回来，否则用户只能关掉弹窗重来
    splitSnapshots.current.set(groupId, { row: f, at: index });
    setFiles((prev) => [...prev.slice(0, index), ...rows, ...prev.slice(index + 1)]);

    // **每段各自识别一次**（用户 2026-09-25 定）。
    //
    // 不这么做的话三段都继承源行**第一页**的判断，而合订谱恰恰是每段不一样的
    // （`Piccolo,_Flute_1,_2.pdf → [4,10]`：前 3 页短笛、中间长笛 1、最后长笛 2）——
    // 第 2、3 段要用户手改，而**改它所需的数据早就在手上了**。
    //
    // 成本：**N 次 LLM、0 次 OCR**（每段的首页窄带文本在分段那一步已经 OCR 过）。
    // 刻意不 `await`：切分要立刻可见，识别结果回来再各就各位。
    void refineSegments(rows, f);
  };

  /**
   * 让每一段用**它自己的首页文本**重新识别一次，然后给漏号的那一段补号。
   *
   * ⚠️ 写回一律走 `updateFileByStorageId`（这段是异步的，行集随时可能被用户改）。
   *
   * ⚠️ **不发源文件名**（第一个参数传 `null`）：段行继承的是**源合订本**的名字，
   * 它描述的是整本、不代表这一段。照它填号会让**每一段**都填成源行那份号
   * （`…--_Piccolo,_Flute_1,_2.pdf` → 段段都是 `[1,2]`），盖过页眉上真正写着的那一行。
   *
   * 号（2026-09-25 改）：段自己读出的号**哪怕是空数组也照写** —— 「这一段没有号」是
   * 一个**完整**的答案（短笛段就是），而旧的「空数组不覆盖」是为了保护按位置预填的号，
   * 那个预填已经删了。真正**没读出来**的那一种由最后那道 `fillMissingSubParts` 兜。
   *
   * 失败不致命：那一段保留继承来的值，只挂一句 `warning`（展开面板里能看到）。
   *
   * @param sourceRow 拆之前那一行（整份那份），补号要用它的乐器与号。
   */
  const refineSegments = async (rows: UploadFile[], sourceRow: UploadFile) => {
    // 包一层只为计「在飞」的数（见 `refiningCount`）—— 内层保持原样，免得整段重排缩进
    setRefiningCount((c) => c + 1);
    try {
      await refineSegmentsInner(rows, sourceRow);
    } finally {
      setRefiningCount((c) => c - 1);
    }
  };

  const refineSegmentsInner = async (rows: UploadFile[], sourceRow: UploadFile) => {
    // 各段**自己**识别出的结果，供最后的补号用。没认出乐器的段不进这个表 ——
    // 它们不参与补号（不知道它是什么，就不知道源行那份号对它成不成立）。
    const seen = new Map<string, { instrument: string; subParts: number[] }>();
    // ⚠️ **必须是限流的循环，不能是 `Promise.all(rows.map(...))`**：后者的 N 个 async
    // 函数体在**同一个 tick** 里同步跑到各自的第一个 await，于是那句 `cancelledRef` 检查
    // 对每一段读到的是同一个值 —— 一次调用都拦不下，是个「看起来承重、其实不承重」的守卫
    //（对抗测试实测）。限流循环在段与段之间有 await，关窗之后剩下的段就真的不发了；
    // 顺带把并发的 LLM 调用数也收在 `PIPELINE_CONCURRENCY` 以内。
    await runWithConcurrency(rows, PIPELINE_CONCURRENCY, async (row) => {
      // 关窗就别再烧配额了：还没发出去的那几段直接不发
      //（同 `analyzeOne` 开头那条判断；已经飞出去的那几个拦不住，但它们是少数）
      if (cancelledRef.current) return;
      const head = row.segHeadText?.trim();
      const id = row.storageId;
      // 拿不到这一段的首页文本（那一页 OCR 失败/被跳过）→ 保留继承来的判断。
      // **不挂 warning**：分段那一步已经在 `segFailedPages` 里报过了，再报一次是噪声。
      if (!head || !id) return;
      try {
        const got = await runLlmAnalysis(null, head);
        const section = got.isFullScore ? FULL_SCORE_SECTION : got.section;
        const instrument = got.isFullScore ? FULL_SCORE_SECTION : got.instrument;
        // ⚠️ **段级「没认出来」与段级「调用失败」对用户是同一件事**（对抗测试实测）：
        // 空答案若照写，这一行会从「继承的整份判断、能直接传」变成「未识别、被
        // `uploadBlocker` 拦下要逐段手填」——而它只是「模型对这一段说不出话」，
        // 恰恰是这批改动预期会出现的形态。失败路径刻意保留继承值，成功路径
        // 却抹掉，是不该有的不对称。所以只把识别**有内容**的结果写回。
        if (!instrument) {
          updateFileByStorageId(id, (cur) =>
            cur.sectionEdit === cur.sectionGuess && cur.instrumentEdit === cur.instrumentGuess
              ? {
                  warning: "这一段没能单独识别（模型没给出乐器）—— 上面是整份的判断，请逐段核对",
                  // ⚠️ **两个诊断字段照样要写回**（对抗测试实测漏掉过）：上面那句 warning 说
                  // 「模型没给出乐器」，而那**正是 `abstainReason` 要拆开的事** —— 弃权可能是
                  // 「模型说了、但我们拒了」（名字里有不能用于文件名的字符）。不写回的话，
                  // 界面上会留着一句会误导的话，而唯一能纠正它的字段被这条 return 丢掉。
                  // （`subParts*` 那几个留着的理由 —— 空答案不该覆盖用户可传的继承值 ——
                  // 不适用于诊断字段：它们不参与 `uploadBlocker`。）
                  sectionRaw: got.sectionRaw,
                  abstainReason: got.abstainReason,
                }
              : {},
          );
          return;
        }
        seen.set(id, { instrument, subParts: got.subParts });
        updateFileByStorageId(id, (cur) => {
          // ⚠️ **用户在这几秒里自己改过这一段的声部/乐器 → 以用户的为准，一个字都不覆盖。**
          // 识别结果是异步回来的，而抹掉用户刚落的手是最难受的一种「智能」；
          // 判据是「编辑框还等于切分时预填的那个值」，也就是他没动过。
          // 两个字段**各自**判断：用户改了声部不该连带挡住模型给的乐器名
          return {
            sectionGuess: section,
            instrumentGuess: instrument,
            // 同 `analyzeOne`：判据是「Edit 仍等于 Guess」。
            // ⚠️ 这是**值比较、不是「动过没有」的标记** —— 用户改成别的再改回来，
            // 判据就成立、他的最后一次表态会被覆盖。取舍：加一个显式标记要新增字段
            // （`subPartsEditText` 那种），而这条路径的收益不值那个成本。
            ...(cur.sectionEdit === cur.sectionGuess ? { sectionEdit: section } : {}),
            ...(cur.instrumentEdit === cur.instrumentGuess ? { instrumentEdit: instrument } : {}),
            extraSectionsGuess: normalizeExtraSections(got.section, got.extraSections),
            llmResult: got.isFullScore
              ? "识别结果: 总谱（整份）—— 不参与分段"
              : analysisSummary(got.section, got.instrument, got.subParts),
            evidence: got.evidence,
            evidenceFound: got.evidenceFound,
            evidenceFromFileName: got.evidenceFromFileName,
            // 声部漂移与弃权原因同理（pkuso-web#302）：段级识别也会漂移 / 也会弃权
            sectionRaw: got.sectionRaw,
            abstainReason: got.abstainReason,
            // 空数组也照写 —— 「这一段没有号」是完整答案（见 docblock）
            subPartsGuess: got.subParts,
            subPartsRaw: got.subPartsRaw,
            subPartsOverCap: got.subPartsOverCap,
            // 这一段自己识别成功了 → 清掉上一次的失败提示（可能来自更早的一次切分）
            warning: undefined,
            // ⚠️ **只清「同组重名」那一条 `error`**（2026-09-25）：拆完号是空的，几秒后
            // 识别才回来 —— 用户若在这中间点了「确认上传」，会被那句重名拦下、红字留在
            // 行上；等号各自落地、名字已经不同了，那句却没人清。
            // **不能无条件清**：那会把「上传失败」那类红字一起抹掉，用户会以为传上去了。
            //
            // ⚠️ **与 `refiningCount` 是双保险，目前不可达**：那条 `error` 的唯一产生点是
            // 点「确认上传」（`duplicatedInGroup` 那一支），而那时 `refiningCount` 必为 0
            //（按钮灰着）—— 也就是说识别在飞的窗口里根本产生不出这条 error，这一段清理
            // 今天跑不到。留着是因为它的成本是一行，而**万一哪天 `refiningCount` 那道门
            // 被收窄或去掉**（比如改成只拦「确实有待传行」的判据），这条就会立刻变成活的：
            // 到那时没有它，那句已经过期的红字会赖在行上没人清。变异验证打不红它，属预期。
            ...(cur.error === DUPLICATE_SEGMENT_ERROR ? { error: undefined } : {}),
          };
        });
      } catch (err) {
        updateFileByStorageId(id, (cur) => {
          // 同上：用户动过手就别再往他那一行挂「没能单独识别」的提示
          if (cur.sectionEdit !== row.sectionEdit || cur.instrumentEdit !== row.instrumentEdit) {
            return {};
          }
          return {
            warning: `这一段没能单独识别（${
              err instanceof Error ? err.message : String(err)
            }）—— 上面是整份的判断，请逐段核对`,
          };
        });
      }
    });

    // 组级补号：只剩**一段**没从自己页眉上读出号时，用源行的号做减法补给它
    // （例：整份 `[1,2]` + 第 1 段读出 `[1]` → 第 2 段补 `[2]`）。
    // 三条保守约束（不同乐器不补、漏号不止一段不补、减完没剩余不补）见 `fillMissingSubParts`。
    const src = editsOf(sourceRow);
    // ⚠️ **整组里任何一行被用户动过声部/乐器 → 整组不补**。
    // `fillMissingSubParts` 的约束 1（「乐器与源行相同才补」）判的是**所有段模型读出的**
    // 乐器，而用户改的完全可能是**兄弟段**（模型把 B 段认错了、用户改成别的乐器）——
    // 那时 `taken` 里那个号根本不属于源行那套号，减法算出来的结果就是错的，而界面上
    // 那一格看起来就是识别结果、看不出是猜的。
    // 只盯「被补的那一行」不够 —— 那正是上一轮修复留下的缺口（对抗测试实测）。
    // 取值走 `filesRef`：这段是异步的，`rows` 是拆行那一刻的快照。
    const anyEdited = rows.some((r) => {
      const cur = filesRef.current.find((x) => x.storageId === r.storageId);
      return (
        !!cur &&
        (cur.sectionEdit !== cur.sectionGuess || cur.instrumentEdit !== cur.instrumentGuess)
      );
    });
    const filled = anyEdited
      ? rows.map(() => null)
      : fillMissingSubParts({
          sourceInstrument: src.instrument,
          sourceSubParts: src.subParts,
          // 没进 `seen` 的段（没认出乐器 / 没拿到首页文本）一律按「不认识」算 → 不参与
          segments: rows.map(
            (r) => seen.get(r.storageId ?? "") ?? { instrument: "", subParts: [] },
          ),
        });
    rows.forEach((row, i) => {
      const parts = filled[i];
      const id = row.storageId;
      if (!parts || !id) return;
      updateFileByStorageId(id, (cur) =>
        // 用户自己填过号（`subPartsEditText` 有值）或已经识别出号 → 一个字都不动
        cur.subPartsEditText === undefined &&
        (cur.subPartsGuess ?? []).length === 0 &&
        // ⚠️ **带 `subPartsRaw` / `subPartsOverCap` 的行也不动**：那两种是
        //「**有号但没读懂**」/「后端给的个数超上界」，与「页眉上没印号」是两件事。
        // 补上一个号会让 `subPartsUnread` 变假 → 拦截与黄色提示**同时消失**，
        // 用户拿到一个从没确认过的号，而 `subPartsRaw` 还留在行上、再没有任何渲染路径读它
        // —— 那正是本 issue 要消灭的「静默丢号」的镜像。
        !cur.subPartsRaw &&
        !cur.subPartsOverCap &&
        // ⚠️ **用户在这几秒里改过这一段的声部/乐器 → 也不补**。判据与**同函数上面那次
        // 写回完全同源**（`cur.sectionEdit === cur.sectionGuess` 那一对）。
        // 少了它就有个真窗口：模型把某段的乐器认错、用户趁识别还没落地（乐器输入框那时
        // 是可编辑的）改成别的 —— 而 `fillMissingSubParts` 的约束 1（乐器与源行相同才补）
        // 判的是**模型读出的**那个乐器，于是减法猜出来的号照样写进这一行，
        // `file_name` / `sub_parts` 落一个用户从没确认过的号，界面上还看不出是猜的。
        cur.sectionEdit === cur.sectionGuess &&
        cur.instrumentEdit === cur.instrumentGuess
          ? { subPartsGuess: parts }
          : {},
      );
    });
  };

  /**
   * 把一组切分出来的行还原成原来那一行（用拆分时的快照，连位置一起还原）。
   *
   * ⚠️ **组内只要有一段已经上传成功（`done`），就不许还原**。还原是「从界面上删掉这一组
   * 再放回原来那一行」，而**已经传上去的段不会跟着消失** —— `sheet_music_files` 的行与
   * storage 对象都还在（`onUploaded` 也早跑过了），界面却不再记得它们。接着用户把还原出来
   * 的整本行再传一次，库里就有两份内容：切出来的段 + 整本，而先前那几个对象**再没有任何
   * 界面入口能删**。所以这条不是「体验问题」，是数据一致性问题。
   */
  const canUnsplit = (groupId: string) =>
    !files.some((f) => f.splitOf?.groupId === groupId && f.status === "done");

  const unsplitGroup = (groupId: string) => {
    if (!canUnsplit(groupId)) return;
    const snap = splitSnapshots.current.get(groupId);
    if (!snap) return;
    splitSnapshots.current.delete(groupId);
    setFiles((prev) => {
      // ⚠️ 位置**现算**，不能用拆分时记下的绝对下标：拆 A 再拆 B、先还原 A 再还原 B 时，
      // 那个下标已经过期（B 的 `at` 是它被拆那一刻的位置，A 还原后整条列表都挪过了），
      // 于是 B 会被插到末尾 —— 静默重排用户的导入列表。
      // 一组行是**连续**的（拆分就是把一个下标换成 N 个连续行），所以「这一组的当前位置」
      // 就是它第一个行的下标，插回那里即可，且同样经得起别的组先还原。
      const at = prev.findIndex((f) => f.splitOf?.groupId === groupId);
      const rest = prev.filter((f) => f.splitOf?.groupId !== groupId);
      const pos = Math.min(at < 0 ? snap.at : at, rest.length);
      return [...rest.slice(0, pos), snap.row, ...rest.slice(pos)];
    });
  };

  /** 同一组里与别人**重名**的行下标（切出来的每一份必须靠文件名能区分） */
  const duplicatedInGroup = (groupId: string): Set<number> => {
    const idx = files.map((f, i) => ({ f, i })).filter(({ f }) => f.splitOf?.groupId === groupId);
    const names = idx.map(({ f }) => {
      const e = editsOf(f);
      return generateFileName(e.instrument, e.subParts);
    });
    return new Set(duplicateNames(names).map((k) => idx[k].i));
  };

  /**
   * 声部现在是**闭集**，分组靠 `section` 而不是乐器名 —— 木琴与马林巴都归打击乐，
   * 低音大管归大管。乐器名只进文件名与展示。
   */
  const getOrCreatePart = async (section: string): Promise<string | null> => {
    const { data: existing } = await supabase
      .from("sheet_music_parts")
      .select("id")
      .eq("sheet_music_id", scoreId)
      .eq("section", section)
      .maybeSingle();

    if (existing) return existing.id;

    const { data: newPart, error } = await supabase
      .from("sheet_music_parts")
      .insert({ sheet_music_id: scoreId, section })
      .select("id")
      .single();

    if (error) {
      console.error("Create part failed:", error);
      return null;
    }
    return newPart.id;
  };

  // 三个输入 handler 都顺手清 `error`：那是**上一次**拦截留下的红字，而它只在
  // 「下一次点确认上传且通过判据」时才被清掉 —— 用户明明改好了，红字还挂着，
  // 读起来像「改完还是不行」。（清 error 不会让漏填的行失去提示：
  // 那种行本来就由 `uploadBlocker` 在点上传时重新写一遍。）
  const handleInstrumentChange = (index: number, value: string) => {
    updateFile(index, { instrumentEdit: value, error: undefined });
  };

  const handleSectionChange = (index: number, value: string) => {
    // 选成总谱 = 「整份都在里面」：乐器名与分声部都跟着定下来，不该再让用户填两个
    // 说不通的东西（总谱没有「第几号」）。切回别的声部时不动它们 —— 用户可以用那个
    // 「重置为识别结果」的 X 回到模型给的值。
    if (value === FULL_SCORE_SECTION) {
      updateFile(index, {
        sectionEdit: value,
        instrumentEdit: FULL_SCORE_SECTION,
        // 空串是**显式表态**「没有号」（与「没编辑过」不同），editsOf 会据此给出 `[]`
        subPartsEditText: "",
        error: undefined,
      });
      return;
    }
    updateFile(index, { sectionEdit: value, error: undefined });
  };

  /**
   * 额外声部（跨声部的共用分谱，见 `sections.ts`）的增删。
   *
   * 写进 `extraSectionsEdit` 而不是 Guess：一旦动过，这个字段就是**用户的表态**，
   * 与 Guess 脱钩 —— 与 `sectionEdit` / `instrumentEdit` 同一条规矩。
   *
   * **存的是清洗后的值**（不是用户点的那个原始数组）：上界、去重、去主声部都由
   * `normalizeExtraSections` 判一次，于是界面上的 chip 数 = 真实会落库的声部数，
   * 两者不可能分叉。清洗规则只此一份（后端 `parseExtraSections` 是同一套）。
   */
  const setExtraSections = (index: number, next: string[]) => {
    const f = files[index];
    if (!f) return;
    const primary = (f.sectionEdit ?? f.sectionGuess ?? "").trim();
    updateFile(index, {
      extraSectionsEdit: normalizeExtraSections(primary, next),
      error: undefined,
    });
  };

  const addExtraSection = (index: number, value: string) => {
    const f = files[index];
    if (!f) return;
    // 从**当前生效的**那一份出发（Edit 优先，否则 Guess）—— 只走 editsOf，不自己抄推导式
    setExtraSections(index, [...editsOf(f).extraSections, value]);
  };

  const removeExtraSection = (index: number, value: string) => {
    const f = files[index];
    if (!f) return;
    setExtraSections(
      index,
      editsOf(f).extraSections.filter((s) => s !== value),
    );
  };

  const handleSubPartsChange = (index: number, value: string) => {
    // 存**原文**而不是解析结果：解析结果会把用户正在敲的 `1,` 归一成 `1`，
    // 逗号在受控输入里当场消失，`1,2` 永远敲不出来。解析发生在读取时（editsOf）。
    updateFile(index, { subPartsEditText: value, error: undefined });
  };

  const confirmUpload = async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setPhase("uploading");

    let hasSuccess = false;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        alert("请先登录");
        return;
      }

      // 声部：**按需建、同一个声部全批只发一次** SELECT+INSERT。
      //
      // 为什么不能让每个 worker 各自去建：getOrCreatePart 是「先 SELECT 再 INSERT」，
      // 两个并发 worker 撞上同一个新声部会双双查空、双双插入 → **重复声部行**
      // （表上还没有唯一约束）。这里用 Map 存**同一张票（promise）**，后到的 await 同一张，
      // 竞态就没了 —— 靠的是一张票，而不是靠「先把全批串行建完」。
      //
      // 也**不能**先串行把全批声部建出来：取消（或中途失败）会留下一批**没有任何文件
      // 指向的空声部**，而曲谱详情页会把它们逐个列出来、只能手工删。按需建才是
      // 「用到了才留下」，且建失败天然只影响用到它的行（保持逐行语义）。
      const partTickets = new Map<string, Promise<string | null>>();
      const ensurePart = (section: string): Promise<string | null> => {
        let ticket = partTickets.get(section);
        if (!ticket) {
          // get → 调用 → set 之间没有 await，两个 worker 不会各拿到一张票
          ticket = getOrCreatePart(section);
          partTickets.set(section, ticket);
        }
        return ticket;
      };

      /**
       * 上传的**单元**：普通行各自一个单元；合订谱切出来的 N 段合成**一个**单元 ——
       * 因为它们的源文件是同一份，而「一份文件只 load 一次」是切分的硬约束。
       * 单元内部逐段串行：切一份 → 传一份 → 丢掉引用，峰值 ≈ 源 + 最大一段。
       */
      const units: Array<Array<{ f: UploadFile; i: number }>> = [];
      const groupAt = new Map<string, number>();
      files.forEach((f, i) => {
        const gid = f.splitOf?.groupId;
        if (!gid) {
          units.push([{ f, i }]);
          return;
        }
        const at = groupAt.get(gid);
        if (at === undefined) {
          groupAt.set(gid, units.length);
          units.push([{ f, i }]);
        } else {
          units[at].push({ f, i });
        }
      });
      // 组内按段序（而不是列表顺序），这样切出来传给 storage 的顺序与页序一致
      for (const unit of units) {
        unit.sort((a, b) => (a.f.splitOf?.segIndex ?? 0) - (b.f.splitOf?.segIndex ?? 0));
      }

      /**
       * 切分单元的**串行闸**：issue 明确「切分阶段串行、并发 1」，`split-pdf.ts` 的
       * 峰值分析也是按这个写的（峰值 ≈ 源 + 最大一段）。与普通行共用并发池的话，
       * 最多可以有 `PIPELINE_CONCURRENCY` 个源文件同时驻留 —— 峰值直接乘以并发数。
       *
       * 串行**不损失什么**：切分是 CPU 密集（`copyPages` + `save` 都在主线程），
       * 本仓早就量过「并发不会让纯 CPU 的工作变快」，而普通行（网络等待）照旧并发。
       */
      let splitChain: Promise<unknown> = Promise.resolve();
      const serializeSplit = <T,>(fn: () => Promise<T>): Promise<T> => {
        const run = splitChain.then(fn, fn);
        splitChain = run.catch(() => {});
        return run;
      };

      // 并发上传 + 落库。结果乱序返回没关系：列表是按行状态驱动的，
      // updateFile(i, …) 按索引更新，互不干扰。
      await runWithConcurrency(units, PIPELINE_CONCURRENCY, async (unit) => {
        // 取消时最多再做已在飞的那几个（其余 worker 领到单元会立刻返回）
        if (cancelledRef.current) return;

        /** 一个单元里的一行：Blob 由调用方给（普通行就是它自己，切分行是切出来的那一段） */
        const uploadOne = async (
          uploadFile: UploadFile,
          i: number,
          blob: Blob,
        ): Promise<boolean> => {
          // 声部与乐器名分开取：声部是闭集（写进 parts.section），
          // 乐器名是开集（写进 files.instrument，也是文件名主干）
          const { section, extraSections, instrument, subParts, subPartsInvalid, subPartsUnread } =
            editsOf(uploadFile);

          // 拦下，但**不改状态**。这两行缺的是用户补填，而编辑器只在有识别结果的行上
          // 渲染 —— 置成 error 会让输入框消失，界面变成「让你填却没有字段可填」，
          // 用户只能关掉弹窗、连带丢掉整批已经烧掉 OCR 配额的分析结果。
          const blocker = uploadBlocker({ section, instrument, subPartsInvalid, subPartsUnread });
          if (blocker) {
            updateFile(i, { error: blocker });
            return false;
          }

          // **分了段却没拆**就上传 = 悄悄只传一份出去，而屏幕上明明写着「共 N 段」——
          // 用户看到的分段结果等于白做。两条出路都写进文案里：拆开，或者合并成一段
          // （合并 = 「这本来就是一份」，那正是他不同意模型时的表达方式）。
          //
          // ⚠️ 判据必须与**解除这个拦截的条件**同源：`segEligible` 为假的行（总谱、单页、
          // 已 done）根本不渲染分段块，也就没有「确认这 N 段」「合并」可按 —— 拦下它就等于
          // 把那一行锁死。实测过这条路径：跑完分段再把声部改成总谱 → 分段块消失、拦截还在，
          // 唯一出路是改回声部或关窗重来（而「先跑分段、看段数再标总谱」正是人工标记的主用法）。
          if (unsplitSegments(uploadFile)) {
            const segCount = segmentsOf(uploadFile).length;
            updateFile(i, {
              error:
                `这份谱识别出 ${segCount} 段 —— 请先点「确认这 ${segCount} 段」逐段确认；` +
                `如果它其实是一份，用「合并」把段并成一段`,
            });
            return false;
          }
          // 这一行能往下走了，把上一次的拦截/失败提示清掉，免得文案留在界面上说谎
          updateFile(i, { error: undefined, status: "uploading" });

          // 这一行要落成**几条**（跨声部的共用分谱多于一条，见 sections.ts）。
          // 判据只此一份 —— 文件名、落库行数、界面上的 chip 都从 `editsOf` 这一条路来。
          const targets = fileTargetsOf(section, extraSections, instrument, subParts);
          // 理论上到不了这里（`uploadBlocker` 已经拦下空声部），但**必须当失败报**：
          // 空数组会让这次上传什么都不插却回一个「成功」——那正是本仓反复记载的静默失败。
          if (targets.length === 0) {
            updateFile(i, { status: "error", error: "没有可落库的声部" });
            return false;
          }

          // 每个落点**各自一个存储对象**。
          //
          // ⚠️ 这里原来写的是「多条行共用同一个 `storage_path`」（一份物理分谱、一个对象），
          // **那是错的，已改**：详情页删除时是**无条件**删对象的 —— `[id]/page.tsx` 的
          // `deleteFile` / `deletePart` 都是**先** `storage.remove(...)`、**再**删行。
          // 共用对象的话，删掉「大提琴」那一行会把 PDF 一起删掉，而「低音提琴」那行还指着它：
          // 详情页里看着完好，**下载时 404**，用户没有任何线索。
          // 改成共用需要把详情页那两条删除路径都改成「先查还有没有别人引用」——
          // 那是另一处改动（且那个页面在本仓没有测试），所以这里让每个落点独立，
          // 把耦合**从构造上**消掉。代价只是同一份字节在桶里存了两份。
          //
          // 路径的 id 由行自己的 `storageId` 派生（第 0 个仍用原值，保持既有行的形态不变），
          // 所以**重试仍走同一条路径 + `upsert`**，不会留下一堆孤儿对象 ——
          // ⚠️ 但那只在**落点集不变**时成立（路径按落点**位置**派生）：若一次尝试传成功、
          // 批量 insert 失败、用户又把落点数改小，多出来的 `${base}-1` 就没人引用了，
          // 而详情页的删除路径是按行枚举对象的，从界面上删不掉。见 `storageId` 的说明。
          const baseStorageId = uploadFile.storageId ?? crypto.randomUUID();
          // 与 `targets` **逐位对应**的存储路径（下标 k 的落点用 `paths[k]`）。
          // 不用「给 target 挂一个可变字段」的写法：`FileTarget` 是纯数据，
          // 往它身上塞运行期的副作用会让 `fileTargetsOf` 的返回值不再是纯函数的结果。
          const paths: string[] = [];
          for (let k = 0; k < targets.length; k++) {
            const filePath = pathOf(scoreId, k === 0 ? baseStorageId : `${baseStorageId}-${k}`);
            const { error: uploadError } = await supabase.storage
              .from("sheet-music")
              .upload(filePath, blob, { contentType: "application/pdf", upsert: true });
            if (uploadError) {
              updateFile(i, { status: "error", error: uploadError.message });
              return false;
            }
            paths.push(filePath);
          }

          // 声部按需建（同一张票，见 `ensurePart`）。**先把所有声部建齐，再插文件行**：
          // 建失败时一行文件都没插，不会留下「半条」记录。
          //
          // ⚠️ 已知代价：**这么建出来的声部不会回滚**。中途某个 `ensurePart` 失败时，
          // 已经建好的那几个 part 会留下、而一行文件都没插 → 详情页多出「0 个文件」的空声部
          // （只能人工删）。**最多留 = 落点数个**（1 个主声部 + `MAX_EXTRA_SECTIONS` 个额外声部），
          // 属既有形态（以前最多 1 个）的放大。
          //
          // **不要「失败时把刚建的 part 删掉」**：`ensurePart` 的票是**按 section 共享**的，
          // 同一批里别的行（甚至并发的另一个 worker）可能正要用那个 part —— 回滚会把
          // 别人正在用的声部删掉，比留一个空声部糟得多。空声部是可恢复的（删除按钮一直渲染）。
          // ⚠️ 用生成类型里的 Insert，而不是 `Record<string, unknown>`：后者与库形状脱钩，
          // 泛型一接上就报错（#314）。列名/可空性写错都会在这里被编译器拦住。
          const rows: Array<Database["public"]["Tables"]["sheet_music_files"]["Insert"]> = [];
          for (const [k, target] of targets.entries()) {
            const partId = await ensurePart(target.section);
            if (!partId) {
              updateFile(i, { status: "error", error: `创建声部失败（${target.section}）` });
              return false;
            }
            rows.push({
              part_id: partId,
              storage_path: paths[k],
              file_name: target.fileName,
              // 乐器名单独存一列，与派生出的文件名分开 —— 便于区分
              // 「LLM 答错」与「文件名生成错」
              instrument: target.instrument,
              // 分声部号同样单独存一列。**它此前只活在 file_name 字符串里** ——
              // 详情页刷新后拿不到分声部，排序与显示都无从谈起；文件名不是数据。
              // 多条落库行共用同一份号：它们是同一个物理分谱的不同落点。
              sub_parts: subParts,
              file_size: blob.size,
              uploaded_by: user.id,
            });
          }

          // ⚠️ **一次批量 insert，不是循环 N 次。**
          //
          // 循环插的话，第 k 条失败会留下前 k-1 行；而重试会把它们**再插一遍** ——
          // 详情页出现两份同名文件（`storage_path` 也相同），事后无法分辨哪行是多的。
          // 这条路径正是本次改动最容易出错的地方。
          //
          // 依据分两半，把握程度不同，别当成一件事：
          // · **实测**：传数组时 supabase-js 只发**一个** POST（body 是 JSON 数组），
          //   循环则发 N 个。复现：建一个客户端时把 `global.fetch` 换成打桩函数，
          //   分别调一次 `.insert([a, b])` 与两次 `.insert(a)` / `.insert(b)`，数调用次数。
          // · **假设**：PostgREST 把那个数组体翻译成**一条**多行 INSERT，而单条语句在
          //   PG 里是原子的（全落或全不落）。这是 PostgREST 批量插入的既有行为，
          //   但本仓没有对它的直接实测 —— 若哪天要完全坐实，得在库里制造一次部分失败
          //   再看有没有半截数据。**这一半不成立的话，下面这道防线就只是「少发几个请求」。**
          //
          // ⚠️ **它只挡住「部分提交」这一半，挡不住「响应丢了」。** 请求已经提交、而响应
          // 在路上丢（网关 504 / 断网）时，客户端只知道失败；用户再点一次「确认上传」，
          // 同一个 `storageId` 算出同一批路径 → 会**再插一遍**。
          //
          // 那一半靠**库里那条唯一约束**兜（pkuso-backend#29）：
          // `sheet_music_files` 上是 `unique (part_id, file_name)`，而这里用 `upsert`
          // 指定同一个 `onConflict` —— 于是「重试」变成「把原来那几行更新一遍」，**幂等**。
          //
          // ⚠️ **顺序不能反**：`onConflict` 要求那条唯一索引**已经存在**，否则 PG 报 42P10。
          // 所以后端那条迁移必须先上（见那个迁移文件顶部的说明）。
          //
          // ⚠️ 顺带一条**行为变更**：约束同时禁止「同一个声部下两份同名的谱」——
          // 这以前是能传上去的（详情页出现两行分不清的同名文件）。撞上时 `insert` 会整批失败，
          // 所以下面把唯一冲突翻译成用户看得懂的话（见 `describeInsertError`）。
          const { error: dbError } = await supabase
            .from("sheet_music_files")
            .upsert(rows, { onConflict: "part_id,file_name" });

          if (dbError) {
            updateFile(i, { status: "error", error: describeInsertError(dbError, targets) });
            return false;
          }

          updateFile(i, { status: "done", instrumentGuess: instrument });
          return true;
        };

        // —— 普通行：字节就是它自己，完全不碰 pdf-lib ——
        if (unit.length === 1 && !unit[0].f.splitOf) {
          const { f, i } = unit[0];
          if (f.status === "done") return;
          if (await uploadOne(f, i, f.file)) hasSuccess = true;
          return;
        }

        // —— 切分行：源文件 load 一次，逐段切、逐段传、逐段丢 ——
        const pending = unit.filter(({ f }) => f.status !== "done");
        if (pending.length === 0) return;
        const src = pending[0].f;
        const range = src.splitOf!;
        // 组内重名会让详情页出现几份分不清的文件 —— 与逐行拦截同一个理由，先拦再说
        const dup = duplicatedInGroup(range.groupId);
        if (pending.some(({ i }) => dup.has(i))) {
          for (const { i } of pending) {
            if (dup.has(i)) updateFile(i, { error: DUPLICATE_SEGMENT_ERROR });
          }
          return;
        }

        await serializeSplit(async () => {
          let source: Awaited<ReturnType<typeof openForSplit>> | null = null;
          /**
           * 这一段里**已经传成功**的行下标。
           *
           * ⚠️ 不能用 `f.status !== "done"` 判断：`pending` 与 `f` 都是**点击那一刻的
           * 闭包快照**，那一整个表达式恒为真 —— 于是「第 1 段传成功、第 2 段上传时断网」
           * 会把 4 段全标成失败，用户重试后第 1 段**又插一行** `sheet_music_files`
           * （同一个 storage 对象挂两行，详情页出现两份同名文件）。
           * 实测过：重试后 `圆号_1.pdf`（当时的格式）确实出现两行。
           */
          const uploaded = new Set<number>();
          try {
            source = await openForSplit(src.file);
            for (const { f, i } of pending) {
              if (cancelledRef.current) return;
              const seg = f.splitOf!;
              // 切一份 —— 只搬 PDF 对象、不解码图像流
              const bytes = await source.extract(seg.from, seg.to);
              const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
              if (await uploadOne(f, i, blob)) {
                uploaded.add(i);
                hasSuccess = true;
              }
              // 传完立刻丢引用：峰值 ≈ 源 + 最大一段（而不是「源 + 全部段」）
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // 加密的 PDF 会在这里抛 `EncryptedPDFError`（见 `openForSplit` 的说明）。
            // 原文是英文、而且只在「确认上传」时才出现 —— 那时用户已经逐段填完乐器与号，
            // 给一句「怎么退回去」的中文，比抛一个类名有用得多。
            const encrypted = err instanceof Error && /EncryptedPDF/i.test(err.name + message);
            const hint = encrypted
              ? "这份 PDF 有加密，无法切分 —— 请点「还原为一份」后整份上传"
              : `切分/上传失败：${message}`;
            // 只标**没成功过**的那些行（见上面 `uploaded` 的说明）
            for (const { i } of pending) {
              if (!uploaded.has(i)) updateFile(i, { status: "error", error: hint });
            }
          } finally {
            source = null;
          }
        });
      });
    } catch (err) {
      // 任何一步意外 reject（例如 supabase-js 的 navigator.locks 以非 AbortError 拒绝时
      // getUser() 会抛）都不能让弹窗卡死在「上传中」——那会锁死 uploadingRef，
      // 用户只能关掉弹窗，而关掉就丢掉整批已烧掉的分析结果。
      //
      // 还把停在「上传中」的那几行退回「已分析」：否则它们会永远转圈，
      // 而没有文件保持 analyzed 时「确认上传」按钮也会被禁用，用户连重试都做不到。
      setFiles((prev) =>
        prev.map((f) => (f.status === "uploading" ? { ...f, status: "analyzed" } : f)),
      );
      alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      uploadingRef.current = false;
      // 已经传成功的要让列表刷新；组件已被卸载时 onUploaded 打给父组件，仍应执行
      if (hasSuccess) onUploaded();
      if (!cancelledRef.current) setPhase("confirm");
    }
  };

  // 是否有文件正在分析中
  const hasAnalyzingFiles = files.some((f) => f.status === "analyzing");
  /**
   * 这次点「确认上传」真的会去传的行数（兼作按钮的启用判据与进度显示）。
   *
   * 判据必须是「**还没传成功的、且分析过**」，不能是「状态是 analyzed」——
   * 上传失败的行会变 `error`，若不算进来，analyzed 计数归零会让按钮**永久禁用**，
   * 而上传循环的注释明写「失败的行要允许重试」。那时用户唯一的出路是关掉弹窗，
   * 而代价是丢掉整批已经烧掉 OCR 配额的分析结果。
   */
  const uploadableCount = files.filter(
    (f) => f.status !== "done" && f.instrumentGuess !== undefined,
  ).length;
  /** 传成功的行数。用于判断「这一批是不是已经干完了」。 */
  const doneCount = files.filter((f) => f.status === "done").length;
  /**
   * 活干完了：没有待传的行，且至少成功过一个。
   *
   * 没有这个状态时，全部传完后按钮是「确认上传（0/N）」且禁用 —— 用户没有任何
   * **正向出口**，只能点「取消」或右上角关闭，看起来像没成功。（合规审查报过。）
   */
  const allDone = uploadableCount === 0 && doneCount > 0 && !hasAnalyzingFiles;

  return (
    // 用全屏层而不是默认的底部弹窗：20 个文件的结果 + 每行的三个输入框，
    // 底部弹窗装不下（原先列表只有 max-h-80，剩下的全靠页面自己滚）。
    <Modal
      open={open}
      onClose={onClose}
      title="上传乐谱文件"
      position="fullscreen"
      // 上传途中不让点遮罩关掉：会静默中止剩余的传输，用户以为只是关了窗口。
      // 仓库既有写法同此（page.tsx 新增曲子弹窗、create-schedule-modal.tsx）。
      // 分析阶段仍可关（那是「取消分析」的正当出口）。
      closeOnOverlay={phase !== "uploading"}
    >
      <div className="flex flex-1 min-h-0 flex-col gap-4">
        {phase === "select" && (
          <>
            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.zip"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <p className="text-text-muted">点击选择文件</p>
              <p className="text-sm text-text-muted mt-1">支持 PDF 或 ZIP（自动解压）</p>
            </div>

            {files.length > 0 && (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                  {files.map((f, i) => (
                    <div
                      key={i}
                      className="bg-card border border-border rounded-lg px-3 py-2 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text truncate">{f.originalName}</p>
                          <p className={`text-xs ${statusColor(f)}`}>{statusText(f)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="p-1 text-text-muted hover:text-danger"
                        title="移除"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                {/*
                 * 左下角两个开关（#297），**必须在点火前可勾** —— 它们改的是这一批会烧掉
                 * 多少 OCR：「分析总谱」把单份的最坏成本从 1 次抬到 6 次，「乐谱分段」
                 * 把整批的成本从「份数」抬到「页数」量级。摆在这里而不是设置页，是因为
                 * 这两个数在导入前才算得出来（要等文件名/页数都定了）。
                 */}
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={analyzeFullScore}
                      onChange={(e) => setAnalyzeFullScore(e.target.checked)}
                      className="accent-primary"
                    />
                    <span title="首页读不出乐器时继续往后看几页，用来认出扉页起排的总谱。单份的 OCR 成本随之上升，见下方数字。">
                      分析总谱
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoSegment}
                      onChange={(e) => setAutoSegment(e.target.checked)}
                      className="accent-primary"
                    />
                    <span title="分析完对多页的合订谱跑窄带 OCR，把各声部的位置找出来。整批的成本按页数算。">
                      乐谱分段
                    </span>
                  </label>
                  {/*
                   * 点火前的代价（#290 的验收标准之一：调用次数在导入前可见）。
                   *
                   * **报上界而不是「约」** —— 这个数由 `analysis.ts` 的 `estimateAnalysisOcrCalls` 按常量算出、
                   * 不依赖语料，写成确定的数才是真的；分段那边报「约」是因为每页窄带多大
                   * 要渲染完才知道（见 `segmentation.ts` 的 `estimateOcrCalls`，那是另一件事）。
                   */}
                  <p className="text-label text-text-muted" data-testid="analysis-ocr-cost">
                    分析最多 {estimateAnalysisOcrCalls(files.length, analyzeFullScore)} 次 OCR
                    {analyzeFullScore ? "（多数文件 1 次）" : ""}
                  </p>
                </div>
                {/*
                 * ⚠️ 开关块**必须在操作行之外**（上面那一行），不能塞进来做左右两端分布：
                 * CLAUDE.md #182 定的是操作行一律 `justify-end` 靠右下角、禁止左右两端分布，
                 * 而窄屏上那么放还会让按钮组吃掉小半行，把左边的成本行挤成好几行。
                 */}
                <div className="flex justify-end gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text">
                    取消
                  </button>
                  <button
                    onClick={startAnalysis}
                    disabled={files.length === 0}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    开始分析 ({files.length} 个文件)
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/*
         * 单一列表，**按行状态驱动**而不是按阶段切换。
         *
         * 原先「分析中」与「确认」是两个几乎相同的块，编辑 UI 只长在后者里 ——
         * 于是用户必须等**全部**文件跑完才能改任何一个。现在两者合并：某个文件
         * 一分析完（status 变 "analyzed"）它那一行的输入框就出现，不必等其余的。
         */}
        {phase !== "select" && (
          <>
            {/* flex-1 min-h-0：全屏层里列表吃掉剩余高度、自己滚；页脚固定在底部 */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {files.map((f, i) => (
                <FileRow
                  key={i}
                  f={f}
                  i={i}
                  phase={phase}
                  expanded={expandedIdx === i}
                  onToggleExpand={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  segBusy={segBusy}
                  hasAnalyzingFiles={hasAnalyzingFiles}
                  canUnsplit={canUnsplit}
                  unsplitGroup={unsplitGroup}
                  duplicatedInGroup={duplicatedInGroup}
                  onUpdateFile={updateFile}
                  onRetryRow={retryRow}
                  onInstrumentChange={handleInstrumentChange}
                  onSectionChange={handleSectionChange}
                  onAddExtraSection={addExtraSection}
                  onRemoveExtraSection={removeExtraSection}
                  onSubPartsChange={handleSubPartsChange}
                  onSegmentStartRawChange={setSegmentStartRaw}
                  onCommitSegmentStart={commitSegmentStart}
                  onMergeSegment={mergeSegmentAt}
                  onSplitSegment={splitSegmentAt}
                  onSplitIntoSegments={splitIntoSegments}
                />
              ))}
            </div>

            <FooterBar
              phase={phase}
              totalCount={files.length}
              uploadableCount={uploadableCount}
              doneCount={doneCount}
              allDone={allDone}
              hasAnalyzingFiles={hasAnalyzingFiles}
              segBusy={segBusy}
              refiningCount={refiningCount}
              segTargets={segTargets}
              segCost={segCost}
              onClose={onClose}
              onStartSegmentation={startSegmentation}
              onConfirmUpload={confirmUpload}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
