"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { runWithConcurrency } from "@/lib/concurrency";
import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from "@/constants/instruments";
import {
  boundarySpan,
  estimateOcrCalls,
  estimateTotalOcrCalls,
  mergeSegmentIntoPrev,
  moveSegmentStart,
  needsSegmentation,
  normalizeSegments,
  parseBoundaryText,
  splitSegment,
  startsFromResponse,
} from "./segmentation";
import {
  fillMissingSubParts,
  formatSubParts,
  generateFileName,
  MAX_SUB_PARTS,
  parseSubPartsInput,
} from "./sub-parts";
import { fileTargetsOf, MAX_EXTRA_SECTIONS, normalizeExtraSections } from "./sections";
import { duplicateNames, openForSplit, splitRefusal } from "./split-pdf";
import type { LlmAnalysis, UploadFile, UploadModalProps } from "./upload-modal.types";
import {
  analysisSummary,
  canHaveExtraSections,
  describeInsertError,
  editsOf,
  isFullScoreRow,
  isKnownSection,
  unreadMessage,
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
  const [phase, setPhase] = useState<"select" | "analyzing" | "confirm" | "uploading">("select");
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
            // 「定了就停」这条判据只有一份，见 `analysisSettled`。
            if (analysisSettled(got)) return true;
            // ⚠️ **这里必须是「继续循环」而不是 `return`**：这一页还剩一张图（整页）没试。
            // 早先写成 `return analysisSettled(got)`，直接退出了整个 attempt 循环 ——
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
      // 别再把空串当成「后端弃权」的同义词（同 `runLlmAnalysis` 里那句）。
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
        // ⚠️ 这一行曾经漏掉：`runLlmAnalysis` 算出了 overCap、`subPartsNotice` 也写了那一支，
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
   * 这份文件要不要跑分段：**多页、非总谱**。
   *
   * 总谱的排除是用户定的（省掉最大的一笔 OCR）；而「总谱认不出来」这件事有实测支撑
   * （三个本地判据都被否掉，见 #290 的评论），所以只能靠 `section === 总谱` 人工标记兜底。
   * 页数未知（分析失败）时不跑 —— 连成本都算不出来。
   */
  // ⚠️ **必须定义在 `segEligible` 之前**：`segTargets`（下面几行）是**渲染期立即求值**的
  // 语句，而声明在使用点之后的 `const` 会在那一刻撞 TDZ —— 那次事故的记录在
  // `isFullScoreRow` 的 docblock 里（「必须放在模块作用域」那一段）。
  /** 这一行「分析完了但没认出乐器」。它与「已识别」是**两件事**：要提示、要能重试、
   * 且**不该进分段**（见下）。总谱的 instrument 是「总谱」，不会落进来。 */
  const isUnidentified = (f: UploadFile) => f.status === "analyzed" && !editsOf(f).instrument;

  const segEligible = (f: UploadFile) =>
    f.status !== "error" &&
    // **已上传成功的不算**（`status === "done"`）：分段的结果只写进组件 state，
    // 而 `done` 的行**不再渲染编辑器块**（那道门是 `analyzed || error`）—— 于是
    // 份数与真实调用都会白烧：实测 2 份文件、第 1 份已上传、第 2 份被 uploadBlocker
    // 拦下时，按钮按 2 份计费，点下去真的烧掉两份的配额，而第 1 份的段一个都看不到。
    f.status !== "done" &&
    // **已经切出来的段不算**：它们是产物不是源，对一段再跑分段没有意义
    !f.splitOf &&
    // **未识别的行不跑**（2026-09-25 加）：分段是**按页**烧 OCR 的动作，而这一行
    // 「是什么」都还没定 —— 跑完也归不了声部。反过来说，未识别在这条链路里不是
    // 「安全」而是**最贵**的那条路（这正是用户定「尽量减少弃权」的根据之一）。
    // ⚠️ 界面**不能因此把页数藏起来**：页数是「这份文件读到几页」的事实，与要不要
    // 分段无关 —— 有一条集成用例专门钉它不许消失（见 `upload-modal-walk.test.tsx`）。
    !isUnidentified(f) &&
    // 「是不是总谱」只认一个判据（`isFullScoreRow` 走 editsOf）—— 同文件里已经栽过
    // 一次「三处各抄一份推导式」的跟头，不再抄第二份
    needsSegmentation(f.pageCount ?? null, isFullScoreRow(f));

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

  /**
   * 这一份文件还要烧几次 OCR（下界，见 `estimateOcrCalls` 的说明）。
   *
   * 按**缺的页**算：已经在手里的页不重烧（`pageTexts` 只装成功的页，所以失败重试时
   * 这个数正好等于要补的页数）。**按钮文案与「识别中…」那行共用这一个函数** ——
   * 各算一次的话，两个数会在同屏里互相矛盾（一个按整份页数、一个按缺的页数）。
   */
  const costOf = (f: UploadFile) => estimateOcrCalls(f.pageCount ?? 0, f.pageTexts?.length ?? 0);
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

  /** 界面上显示的段（由起点页推出闭区间）。用户改过起点就按改过的算 */
  const segmentsOf = (f: UploadFile) => normalizeSegments(f.segmentStarts ?? [1], f.pageCount ?? 1);

  /**
   * **识别出多段、却还没拆** —— 界面上「确认这 N 段」按钮的显示条件，也是上传时
   * 拦下这一行的条件。**必须是同一个函数**：分成两份写的时候，上传那侧漏掉 `segEligible`
   * 就会造出一个死胡同 —— 跑完分段后把声部改成总谱，分段块整块不渲染（`segEligible` 为假），
   * 而拦截还在，文案指着两个**屏幕上不存在**的按钮。实测过这条路径。
   */
  const unsplitSegments = (f: UploadFile) =>
    segEligible(f) && segmentsOf(f).length > 1 && !f.splitOf;

  /** 段的起点数组（界面上编辑的那个），带兜底 */
  const startsOf = (f: UploadFile) => f.segmentStarts ?? [1];

  /** 输入框原文数组。老状态没有这个字段时按起点回填，保证与 `segmentStarts` 等长 */
  const startTextOf = (f: UploadFile) => f.segmentStartText ?? startsOf(f).map(String);

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

  /**
   * 预览「这将存成什么名字」。乐器名为空时返回空串。
   *
   * 预览的是**人类可读的名字**（`声部 / 文件名`）而不是真实的存储键 ——
   * 存储键现在是 `{scoreId}/{行 id}.pdf`，给用户看一串 uuid 没有意义；
   * 可读名落 `sheet_music_files.file_name`，下载时会用它还原文件名。
   */
  const previewPath = (f: UploadFile) => {
    // 取值**只走 editsOf**（与落库、与 uploadBlocker 是同一条判据）。
    // 早先这里自己抄了一份推导式，于是非法输入时预览会显示成一个**看着完全正常**的
    // `圆号.pdf`（非法时 parse 的 value 恒为 `[]`）—— 而那一行其实传不上去。
    const { section, extraSections, instrument, subParts, subPartsInvalid, subPartsUnread } =
      editsOf(f);
    if (!instrument) return "";
    // 有硬伤时不报一个像样的名字：宁可显示「待确认」，也别让用户以为存的就是它
    if (subPartsInvalid || subPartsUnread) return `${section} / （分声部号待确认）`;
    // **跨声部时要把落点全列出来** —— 只显示主声部的话，用户看到的落库结果与预览对不上，
    // 而这份文件确实会在两个声部组里各出现一次。逐条复用 `fileTargetsOf`（同一个判据），
    // 不在这里另写一套推导式 —— 三处各抄一份的跟头这个文件已经栽过一次。
    return fileTargetsOf(section, extraSections, instrument, subParts)
      .map((t) => `${t.section} / ${t.fileName}`)
      .join("、");
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
          const rows: Array<Record<string, unknown>> = [];
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

  const statusText = (f: UploadFile) => {
    // 取值**只走 editsOf**：行文案必须与文件名预览、落库结果一致，否则用户会以为
    // 「清空没生效」。三处各抄一份推导式就迟早会漂（这个文件里已经栽过一次）。
    const { section, extraSections, instrument, subParts } = editsOf(f);
    const sub = subParts.length > 0 ? ` ${formatSubParts(subParts)}` : "";
    // ⚠️ **跨声部时要把落点写出来**：`previewPath` 已经展开成两个落点，标题只报主声部的话，
    // 同一张卡片里两句话互相矛盾（用户按标题核对会以为只落一个声部）。这条正是上面那句
    // 「必须与预览一致」要守的东西 —— 改成多落点之后漏掉了它，对抗测试实测抓出来的。
    const also = extraSections.length > 0 ? `（并另存到 ${extraSections.join("、")}）` : "";
    switch (f.status) {
      case "pending":
        return "待分析";
      case "analyzing":
        return "分析中...";
      case "analyzed":
        // 空乐器名 = **模型自己说不知道**（或响应不可用），必须与「已识别」区分开：
        // 输入框是空的、等用户填，不能显示成识别成功。
        // ⚠️ 「证据不足」不再进这一支（后端已改成照样采用 + `evidenceFound` 提示）。
        return instrument ? `已识别 → ${section} / ${instrument}${sub}${also}` : "需人工确认";
      case "uploading":
        return "上传中...";
      case "done":
        return instrument ? `已上传 → ${section} / ${instrument}${sub}${also}` : "已上传";
      case "error":
        return `失败: ${f.error}`;
    }
  };

  /**
   * 声部词表漂移告警。后端 prompt 里的 16 个声部名与前端 `INSTRUMENT_ORDER`
   * 是两份手抄副本，没有跨仓同步机制 —— 这条告警就是那个机制缺席时的可见信号。
   *
   * ⚠️ **两个来源都要判**（pkuso-web#302）：只看字段里的值（`sectionEdit ?? sectionGuess`）
   * 时，模型返回词表外声部的那条路**完全不可见** —— 后端已经把它折成了合法的「其他」，
   * 于是「漂移」与「模型真的判不出来」在界面上长得一模一样。原值在 `sectionRaw` 里。
   */
  const sectionWarning = (f: UploadFile) => {
    const s = (f.sectionEdit ?? f.sectionGuess ?? "").trim();
    if (s && !isKnownSection(s)) return `声部「${s}」不在标准列表内`;
    // 只陈述模型给过什么，**不**说「已记为其他」：用户可能已经改成别的声部了，
    // 那句话在那时会变成假话（而这一行是排查用的，宁可少说）
    // ⚠️ 用**过去式**（对抗测试实测的取舍）：用户把声部改对之后这句仍然挂着 —— 它陈述的是
    // 模型**当时**给过什么（漂移要维护者去改 prompt 词表），不随用户的修改消失。
    // 说成「现在的声部不在列表内」会让用户以为自己的修改没生效。
    if (f.sectionRaw) return `模型曾给出声部「${f.sectionRaw}」（不在标准列表内）`;
    return "";
  };

  /**
   * 分声部这一格要不要给用户一句话。三种情形都返回文案（空串 = 不用提示）：
   *
   * 1. **输入非法** —— 优先显示，因为它是用户当下能改的；
   * 2. **模型给了号但没读懂**（`subPartsRaw`）—— 这一行看起来是「已识别成功」，
   *    但号是空的，不提示就没人会去填，号就静默丢了；
   * 3. 都不适用 → 空串。
   *
   * ⚠️ 第 2 条只在**用户还没动手**时提示（`subPartsEditText === undefined`）——
   * 否则用户填完之后那句「没读懂」会一直挂着，变成一条永远消不掉的假告警。
   */
  const subPartsNotice = (f: UploadFile) => {
    if (f.subPartsEditText !== undefined) {
      const invalid = parseSubPartsInput(f.subPartsEditText).invalid;
      // ⚠️ 与 uploadBlocker 返回的是同一句话时**让位** —— 否则点一次「确认上传」
      // 会在行里出现两行一模一样的提示（一行黄、一行红），看着像两个不同的问题。
      if (!invalid || f.error === invalid) return "";
      return invalid;
    }
    // 上界漂移：用户解决不了这件事，这句其实是给维护者看的
    if (f.subPartsOverCap) {
      return `后端返回了 ${f.subPartsOverCap} 个分声部号，超过前端上界 ${MAX_SUB_PARTS}，未填入 —— 请核对前后端上限是否一致`;
    }
    if (f.subPartsRaw && (f.subPartsGuess ?? []).length === 0) {
      // 让位判据必须与 uploadBlocker **同源**（同一个 `unreadMessage`）。
      // 早先两处各写一句、措辞差一个字（「模型给的是」vs「模型给的写法是」），
      // 于是这个守卫**结构上永远匹配不上**，用户照样看到黄红两行。
      const msg = unreadMessage(f.subPartsRaw);
      return f.error === msg ? "" : msg;
    }
    return "";
  };

  /**
   * 模型据以判断的那段原文 —— **让用户一眼复核**。
   *
   * ⚠️ 这不是装饰：后端删掉「证据弃权门」的**唯一**依据就是「交给前端提示用户核对」。
   * 不显示的话，那批改动的净效果就是「预填一个可能错的答案 + 显示成已识别」——
   * 比原来（不预填、逼用户填）**更差**。prompt 里也向模型承诺了「让用户一眼就能复核你」。
   *
   * 三种状态合成一句，因为它们对用户是同一件事（「这个结论凭什么」）：
   *   · 引文在原文里找到 → `依据：…`（muted）
   *   · 引文**没**找到   → `依据（未在原文中找到，请核对）：…`（warning）
   *   · 模型没给引文      → `依据：（模型没给引文，请核对）`（warning）
   *
   * ⚠️ **字段缺失（`undefined`）时不显示任何东西** —— 那是「这一行没有这个信号」，
   * 与「模型没给引文」（空串）是两件事，所以判的是 `undefined` 而不是 falsy
   * （口径见 `LlmAnalysis` 的 docblock「为什么这些字段都写成可选」：这里的 `undefined` 判断
   * **不是**兼容层）。
   */
  const evidenceLine = (f: UploadFile): string | null => {
    if (f.status !== "analyzed" && f.status !== "done") return null;
    if (f.evidence === undefined) return null;
    const ev = f.evidence.trim();
    if (!ev) return "依据：（模型没给引文，请核对）";
    // 引文只在**文件名**里 —— 那不是「没找到」，而是「依据不在页面上」（pkuso-web#300）：
    // 出版社把乐器名印在文件名里而页面是扫描件时，抄文件名是**正当**依据；
    // 但用户该去核对的地方不同（看文件名，不是看谱面），所以分开说。
    if (f.evidenceFromFileName) return `依据（来自文件名，不在页面上）：${ev}`;
    return f.evidenceFound === false ? `依据（未在原文中找到，请核对）：${ev}` : `依据：${ev}`;
  };

  /** `evidenceLine` 要不要按警示色显示（没找到 / 没给）。 */
  const evidenceWarn = (f: UploadFile) => f.evidenceFound === false || !(f.evidence ?? "").trim();

  const statusColor = (f: UploadFile) => {
    // ⚠️ 未识别行**不能是绿的**：一行「需人工确认」配上 success 色，用户扫一眼会以为没事。
    if (isUnidentified(f)) return "text-warning";
    const { status } = f;
    switch (status) {
      case "pending":
        return "text-text-muted";
      case "analyzing":
        return "text-primary";
      case "analyzed":
        return "text-success";
      case "uploading":
        return "text-primary";
      case "done":
        return "text-success";
      case "error":
        return "text-danger";
    }
  };

  const hasDetails = (f: UploadFile) =>
    f.ocrText || f.llmResult || f.preview || f.warning || f.cropNote;

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
                   * **报上界而不是「约」** —— 这个数由 `estimateAnalysisOcrCalls` 按常量算出、
                   * 不依赖语料，写成确定的数才是真的；分段那边报「约」是因为每页窄带多大
                   * 要渲染完才知道（见 segmentation.ts 的 `estimateOcrCalls`，那是另一件事）。
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
                <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {hasDetails(f) ? (
                        <button
                          onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                          // 图标按钮必须有无障碍名（也可以被测试直接取到 —— 展开面板里的
                          // 诊断信息此前没有任何用例能触达，见 pkuso-web#302）
                          aria-label={expandedIdx === i ? "收起详情" : "查看详情"}
                          aria-expanded={expandedIdx === i}
                          title={expandedIdx === i ? "收起详情" : "查看详情"}
                          className="shrink-0 text-text-muted hover:text-text"
                        >
                          {expandedIdx === i ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text truncate">{f.originalName}</p>
                        <p className={`text-xs ${statusColor(f)}`}>{statusText(f)}</p>
                      </div>
                      {f.status === "analyzing" && (
                        <span className="shrink-0 animate-spin text-primary">⏳</span>
                      )}
                    </div>

                    {/* 只要这一行**有识别结果**就渲染编辑器，不只是 analyzed：
                        上传失败的行同样需要能改（否则名字打错一次就把该行钉死，
                        只能关掉弹窗重来）。用 `instrumentGuess !== undefined` 区分
                        「分析过」与「分析本身就失败了」——后者没有可编辑的内容。 */}
                    {(f.status === "analyzed" || f.status === "error") &&
                      f.instrumentGuess !== undefined && (
                        <div className="space-y-1.5 pl-5 border-l border-border">
                          {/* 切分出来的行：说清它是**哪几页**（否则几行长得一模一样，
                              用户没法把屏幕上的行和谱子上的段对上），并给一条退回的路 */}
                          {f.splitOf && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs text-primary shrink-0">
                                第 {f.splitOf.segIndex + 1}/{f.splitOf.segTotal} 段 · 源文件第{" "}
                                {f.splitOf.from}–{f.splitOf.to} 页
                              </span>
                              <button
                                onClick={() => unsplitGroup(f.splitOf!.groupId)}
                                // ⚠️ `hasAnalyzingFiles` 与下面「确认这 N 段」是同一条理由：
                                // 这个按钮**会改变 files 的长度**，而分析 worker（含逐行重试）
                                // 手里攥着点击那一刻的下标 —— 重试飞行中还原一份，会让结果
                                // 写进**别的行**、被重试那行永远停在「分析中」。
                                // 见 `retryRow` 的说明与本文件里 `segBusy` 的同类教训。
                                disabled={
                                  phase === "uploading" ||
                                  segBusy ||
                                  hasAnalyzingFiles ||
                                  !canUnsplit(f.splitOf.groupId)
                                }
                                // 已上传的段不能撤销（否则库里会留下界面管不到的孤儿），
                                // 用 title 说清为什么灰着 —— 只灰不给理由，用户会以为坏了
                                title={
                                  canUnsplit(f.splitOf.groupId)
                                    ? "撤销拆分，把这几段还原成原来那一行"
                                    : "这一组已有段上传成功，无法还原（已传的文件不会跟着撤销）"
                                }
                                className="px-1.5 py-0.5 text-xs text-text-muted border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
                              >
                                还原为一份
                              </button>
                            </div>
                          )}
                          {/* 同组重名：详情页会出现几份分不清的文件，上传也会被拦下。
                              （这个块本身就只在 analyzed/error 上渲染，所以不用再判 done） */}
                          {f.splitOf && duplicatedInGroup(f.splitOf.groupId).has(i) && (
                            <p className="text-xs text-danger">
                              与同组的其他段重名 —— 请改乐器名或分声部号
                            </p>
                          )}
                          {/* ⚠️ `flex-wrap` 是必需的：这一行 7 个元素**全部 `shrink-0`**，
                              而卡片是 `overflow-hidden` —— 不换行时窄屏上右边的控件会被裁掉
                              且**滚不到**（实测 448px 下输入框与「重置」按钮就在卡片外）。
                              允许换行后窄屏会折成两行，内容始终可达。 */}
                          <div className="flex flex-wrap items-center gap-0.5">
                            <label className="text-xs text-text-muted w-12 shrink-0">声部</label>
                            {/* 声部按契约是**闭集**，所以用 select 而不是自由文本 ——
                                否则用户能凭空造出一个声部名写进 `parts.section`
                                （那是详情页分组与排序的依据），而后端的闭集校验对
                                用户手输这一层管不着。后端返回的值若不在闭集里，临时补一个
                                选项把它显示出来：词表漂移依然看得见、也依然改得掉。 */}
                            <select
                              value={f.sectionEdit ?? f.sectionGuess ?? OTHER_INSTRUMENT_GROUP}
                              onChange={(e) => handleSectionChange(i, e.target.value)}
                              disabled={phase === "uploading"}
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-26 shrink-0 disabled:opacity-50"
                            >
                              {!isKnownSection(f.sectionEdit ?? f.sectionGuess ?? "") && (
                                <option value={f.sectionEdit ?? f.sectionGuess ?? ""}>
                                  {f.sectionEdit ?? f.sectionGuess}（非标准）
                                </option>
                              )}
                              {INSTRUMENT_ORDER.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                              <option value={OTHER_INSTRUMENT_GROUP}>
                                {OTHER_INSTRUMENT_GROUP}
                              </option>
                              {/* 总谱**必须能选**：它不是声部（见 instruments.ts），
                                  但「总谱不参与切分检测」是用户定的、也是省 OCR 最大的一笔，
                                  而总谱认不出来（三个本地判据都被实测否掉）——人工标记是
                                  唯一入口。选不到它 = 那条分支永远走不到，还不是死代码
                                  那么轻：用户会以为总谱已经被排除了。 */}
                              <option value={FULL_SCORE_SECTION}>{FULL_SCORE_SECTION}</option>
                            </select>
                            <label className="text-xs text-text-muted w-12 shrink-0 ml-1">
                              乐器
                            </label>
                            <input
                              type="text"
                              value={f.instrumentEdit ?? f.instrumentGuess ?? ""}
                              onChange={(e) => handleInstrumentChange(i, e.target.value)}
                              placeholder="乐器名"
                              disabled={phase === "uploading"}
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-26 shrink-0 disabled:opacity-50"
                            />
                            <label className="text-xs text-text-muted w-12 shrink-0 ml-1">
                              分声部
                            </label>
                            <input
                              type="text"
                              // 总谱没有「第几号」：框里直接显示「总谱」并禁用，
                              // 比留一个填什么都说不通的输入框清楚
                              value={
                                isFullScoreRow(f)
                                  ? FULL_SCORE_SECTION
                                  : (f.subPartsEditText ?? formatSubParts(f.subPartsGuess ?? []))
                              }
                              onChange={(e) => handleSubPartsChange(i, e.target.value)}
                              placeholder="号，如 1,2"
                              disabled={phase === "uploading" || isFullScoreRow(f)}
                              title={
                                isFullScoreRow(f) ? "总谱是整份，没有分声部号" : "分声部号，如 1,2"
                              }
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-16 shrink-0 disabled:opacity-50"
                            />
                            {/* 「没有号」——**逃生口**，只在模型给了号却没读懂时出现。
                                没有它的话 uploadBlocker 那道拦截会把人锁死：那种状态下
                                「确实没有分声部」只能靠清空输入框表达，而框本来就空着、
                                用户没有任何操作能表达这个意思。点它 = 显式表态（置成空串）。
                                ⚠️ 三个条件缺一不可，且必须与 `uploadBlocker` 的 `subPartsUnread`
                                **完全同源**。漏掉 `guess 为空` 会让按钮出现在**有号**的行上
                                （小提琴声部推导补出 [1]/[2] 时就是这样，且旁边没有任何提示），
                                点一下就把那个号静默抹掉 —— 与「消灭静默丢号」正好相反。 */}
                            {f.subPartsRaw &&
                              f.subPartsEditText === undefined &&
                              (f.subPartsGuess ?? []).length === 0 && (
                                <button
                                  onClick={() => updateFile(i, { subPartsEditText: "" })}
                                  disabled={phase === "uploading"}
                                  className="px-1.5 py-0.5 text-xs text-text-muted border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
                                  title="这份谱子确实没有分声部"
                                >
                                  没有号
                                </button>
                              )}
                            <button
                              onClick={() =>
                                updateFile(i, {
                                  sectionEdit: f.sectionGuess ?? OTHER_INSTRUMENT_GROUP,
                                  instrumentEdit: f.instrumentGuess ?? "",
                                  // 清掉**编辑痕迹**（`undefined` = 回到识别结果）。
                                  // 与上面两个字段写法不同是有意的：它们存的是值，
                                  // 分声部存的是「原文 + 有没有被编辑过」这个二元状态，
                                  // 置成 Guess 的值会把「没编辑过」这个信息抹掉。
                                  subPartsEditText: undefined,
                                  // 额外声部同理（它是增删出来的列表，没有「初值」这回事）
                                  extraSectionsEdit: undefined,
                                })
                              }
                              disabled={phase === "uploading"}
                              className="p-1 text-text-muted hover:text-primary shrink-0 disabled:opacity-50"
                              title="重置为识别结果"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          {/* 额外声部：「一份谱同时属于两个声部」的落点（见 sections.ts）。
                              能不能有，判据是 `canHaveExtraSections` —— 与 `normalizeExtraSections`
                              **同源**（总谱与「其他」都不能）。
                              「+」这个入口是**必需的**，不是锦上添花：模型对这个字段的稳定性
                              与别的字段一样（#298 记着答案非确定性），判漏时用户得有办法手工补，
                              否则这份谱就永远只归一个声部、而低音提琴组根本看不到它。
                              选项里排除已选的：选了也进不去（清洗会去重），留着只会让人以为没生效。 */}
                          {!canHaveExtraSections(f) &&
                            editsOf(f).section === OTHER_INSTRUMENT_GROUP && (
                              // 「其他」不是「不能加」，而是**加了也没有立足点**（主声部没定，
                              // 「除了主声部还落到…」就无从谈起，见 `normalizeExtraSections`）。
                              // 必须说出这一句：不显示 chip 行而用户刚刚加过一项的话，
                              // 他看到的是「加了没反应」—— 那正是本仓要消灭的静默丢弃。
                              // 总谱不给这句：它是自明的，且分声部那一格已经写着「总谱」。
                              <p className="text-xs text-text-muted pl-5">
                                主声部是「其他」时不会落到具体声部 —— 请先选定声部
                              </p>
                            )}
                          {canHaveExtraSections(f) && (
                            <div className="flex flex-wrap items-center gap-1 pl-5">
                              {/* 「还落到」读起来像「仍然落到」，用户实测反馈迷惑 —— 换成
                                  「并另存到」：它说的是同一份字节会**再落一个文件**，
                                  与 `previewPath` 展开成两个落点这件事对得上。 */}
                              <span className="text-xs text-text-muted shrink-0">并另存到</span>
                              {editsOf(f).extraSections.map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs bg-muted border border-border rounded shrink-0"
                                >
                                  {s}
                                  <button
                                    onClick={() => removeExtraSection(i, s)}
                                    disabled={phase === "uploading"}
                                    className="text-text-muted hover:text-danger disabled:opacity-50"
                                    title={`不再让这份谱落到「${s}」`}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                              {editsOf(f).extraSections.length < MAX_EXTRA_SECTIONS && (
                                <select
                                  // 恒为空串：选完立刻被 onChange 处理掉，框回到「+ 声部」
                                  // 这个提示位（受控 select 靠 value 归位，不需要额外 state）
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value) addExtraSection(i, e.target.value);
                                  }}
                                  disabled={phase === "uploading"}
                                  className="px-1 py-0.5 text-xs bg-muted border border-border rounded shrink-0 disabled:opacity-50"
                                  title="一份谱同时属于两个声部时（如 Violoncello e Basso 是大提琴与低音提琴共用），在这里加上第二个声部；上传时这份文件会同时出现在两个声部里，各自存一份（删掉其中一个不影响另一个）。"
                                >
                                  <option value="">+ 声部</option>
                                  {INSTRUMENT_ORDER.filter(
                                    (s) =>
                                      s !== editsOf(f).section &&
                                      !editsOf(f).extraSections.includes(s),
                                  ).map((s) => (
                                    <option key={s} value={s}>
                                      {s}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )}
                          {sectionWarning(f) && (
                            <p className="text-xs text-warning">{sectionWarning(f)}</p>
                          )}
                          {subPartsNotice(f) && (
                            <p className="text-xs text-warning">{subPartsNotice(f)}</p>
                          )}
                          {evidenceLine(f) && (
                            <p
                              className={`text-xs ${
                                evidenceWarn(f) ? "text-warning" : "text-text-muted"
                              }`}
                            >
                              {evidenceLine(f)}
                            </p>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-text-muted">路径：</span>
                            {previewPath(f) ? (
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                                {previewPath(f)}
                              </code>
                            ) : (
                              <span className="text-xs text-text-muted">填写乐器名后显示</span>
                            )}
                          </div>

                          {/* 分段（#290 Step 1）：只在**多页、非总谱**的文件上出现。
                              边界用「段的起始页」表达 —— 用户改这个数就等于拖动边界，
                              而**不重跑 OCR**（逐页窄带文本留在 pageTexts 里）。
                              段内的乐器/分声部**不在这里编辑**：切分之后每一段会各自成为
                              一行，用的还是上面那套编辑器（同一件事不造两套界面）。

                              ⚠️ 起点输入框存的是**原文**，失焦/回车才提交（见
                              `UploadFile.segmentStartText`）：受控输入直接存派生值的话，
                              打字过程中的中间态会被当成完整值提交，而那会**静默删掉一个
                              边界**（敲 `15` 的第一个字符 `1` 就把上一段并掉了）。 */}
                          {/* ⚠️ 未识别的**多页**文件：**页数照旧要显示**（它是「这份文件
                              读到几页」的事实，与要不要分段无关），但不给分段按钮 ——
                              分段是按页烧 OCR，而这一行是什么都还没定（见 `segEligible`）。
                              这条分支是加 `!isUnidentified(f)` 时补的：不补的话整块 UI
                              消失、页数跟着没了，而有一条集成用例专门钉它不许消失。 */}
                          {!segEligible(f) &&
                            isUnidentified(f) &&
                            // ⚠️ 下面两条与 `segEligible` 同源（对抗测试实测）：
                            // 缺了它们，**段行**（产物，永远不再分段）与**总谱行**
                            // （用户已定不参与切分）都会看到一句做不到的指引 ——
                            // 而照着做不到的指引去试，比不给更贵。
                            !f.splitOf &&
                            !isFullScoreRow(f) &&
                            (f.pageCount ?? 0) > 1 && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-text-muted">分段：</span>
                                <span className="text-xs text-text-muted">
                                  未识别（{f.pageCount} 页）—— 先选定声部，再识别分段
                                </span>
                              </div>
                            )}
                          {segEligible(f) && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs text-text-muted">分段：</span>
                                {f.segState === "running" && (
                                  <span className="text-xs text-text-muted">
                                    识别中…（约 {costOf(f)} 次 OCR）
                                  </span>
                                )}
                                {f.segState === "error" && (
                                  <span className="text-xs text-danger">失败：{f.segError}</span>
                                )}
                                {f.segState === undefined && (
                                  <span className="text-xs text-text-muted">
                                    未识别（{f.pageCount} 页）—— 点右下角「识别分段」
                                  </span>
                                )}
                                {f.segState === "done" && (
                                  <span className="text-xs text-text-muted">
                                    {/* 只有一段时**不提「可改分段点」**：那一段的起点恒为第 1 页，
                                        没有分段点可改 —— 写着只会让人去找一个不存在的东西。
                                        （「拆分」按钮仍然在：模型漏切时那是唯一的出路，
                                        所以这一段不能连块一起藏掉。） */}
                                    {segmentsOf(f).length > 1
                                      ? `识别出 ${segmentsOf(f).length} 段 —— 可改分段点`
                                      : "识别出 1 段"}
                                    {f.segFailedPages?.length
                                      ? `（其中 ${f.segFailedPages.length} 页 OCR 失败，边界可能不全）`
                                      : ""}
                                  </span>
                                )}
                              </div>
                              {/* 部分页 OCR 失败时必须说出来：只说「共 4 段」的话，
                                  「模型没找到边界」与「有一半页没看」在界面上长得一样 */}
                              {f.segState === "done" && (f.segFailedPages?.length ?? 0) > 0 && (
                                <p className="text-xs text-warning">
                                  {/* 拼成一个字符串再渲染：JSX 的折行会被折成一个空格，
                                      中文里就变成「文本 （OCR 失败）」这种多一个空格的排版 */}
                                  {`第 ${f.segFailedPages!.slice(0, 10).join("、")}${
                                    f.segFailedPages!.length > 10 ? "…" : ""
                                  } 页没取到文本（OCR 失败）—— 这几页上不会有边界`}
                                </p>
                              )}
                              {f.segState === "done" && (
                                <ul className="space-y-0.5">
                                  {segmentsOf(f).map((seg, si) => {
                                    const starts = startsOf(f);
                                    const span = boundarySpan(starts, si, f.pageCount ?? 1);
                                    const raw = startTextOf(f)[si] ?? String(seg.from);
                                    const bad =
                                      span !== null &&
                                      parseBoundaryText(raw, span.lo, span.hi) === null;
                                    return (
                                      <li
                                        key={si}
                                        className="flex flex-wrap items-center gap-1.5 text-xs"
                                      >
                                        <span className="text-text-muted shrink-0 w-14">
                                          第 {si + 1} 段
                                        </span>
                                        {si === 0 ? (
                                          <span className="text-text-muted w-16 shrink-0">
                                            第 1 页起
                                          </span>
                                        ) : (
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={raw}
                                            onChange={(e) =>
                                              setSegmentStartRaw(i, si, e.target.value)
                                            }
                                            onBlur={() => commitSegmentStart(i, si)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") commitSegmentStart(i, si);
                                            }}
                                            // ⚠️ `segBusy` 不能漏（2026-09-25）：切点判出后会自动拆，
                                            // 而拆分用的是**这次分段算出来的** `starts`。池子里还有
                                            // 别的文件在跑时，这一行已经 `done`、边界框是可编辑的 ——
                                            // 用户在这儿改的边界会被随后的自动拆按旧快照推翻。
                                            // 收了再丢比直接禁掉更糟，所以与「确认这 N 段」同一条纪律。
                                            disabled={phase === "uploading" || segBusy}
                                            className={`w-14 px-1.5 py-0.5 text-xs bg-muted border rounded shrink-0 disabled:opacity-50 ${
                                              bad ? "border-danger text-danger" : "border-border"
                                            }`}
                                          />
                                        )}
                                        {/* 原文非法时**不显示**这一段当前的区间：那会让
                                            「框里是 1、右边写着 – 第 12 页」看起来像一条
                                            合法的段。改成只给可填范围，用户一眼知道该怎么改。 */}
                                        {bad && span ? (
                                          <span className="text-danger">
                                            起点要填 {span.lo}–{span.hi}
                                          </span>
                                        ) : (
                                          <span className="text-text-muted">– 第 {seg.to} 页</span>
                                        )}
                                        {si > 0 && (
                                          <button
                                            onClick={() => mergeSegmentAt(i, si)}
                                            disabled={phase === "uploading" || segBusy}
                                            className="px-1.5 py-0.5 text-text-muted border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
                                            title="删掉这条边界，把这一段并进上一段"
                                          >
                                            合并
                                          </button>
                                        )}
                                        {/* 后端刻意「宁可少切，不可多切」，所以**漏切是常态**：
                                            没有这个按钮，用户遇到漏切只能重跑分段（再烧 N 次 OCR） */}
                                        <button
                                          onClick={() => splitSegmentAt(i, si)}
                                          disabled={
                                            phase === "uploading" ||
                                            segBusy ||
                                            seg.to - seg.from < 1
                                          }
                                          className="px-1.5 py-0.5 text-text-muted border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
                                          title="在这一段中间加一条边界（模型漏切时用）——不重跑 OCR"
                                        >
                                          拆分
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              {/* 边界确认完了就拆成多行（#290 Step 2）：拆完每段各占一行、
                                  各有各的乐器/号，上传时源文件只读一次、逐段切出来各传各的。
                                  放在这里（而不是上传时才切）是因为**每一段都要人工确认乐器
                                  与号** —— 那是拆完之后才看得见的东西。

                                  ⚠️ **`!segBusy` 不能漏**（用户实测反馈）：自动拆要等**整个
                                  分段池**跑完才执行，而池子里先跑完的那几行此时已经是
                                  `segState: "done"` —— 于是「识别中」的窗口里它们会挂着一个
                                  「确认这 N 段」，全部跑完才消失。那是个**一闪而过且点不了**
                                  （按钮自身被 `segBusy` 禁用）的按钮，用户只会以为功能坏了。
                                  分段在跑 = 自动拆还没轮到，这一刻不该给手动入口。
                                  池子跑完后 `segBusy` 落下，若 `splitRefusal` 拒了，
                                  按钮会照常回来 —— 那条后备路没被堵掉。 */}
                              {unsplitSegments(f) && !segBusy && (
                                <button
                                  onClick={() => splitIntoSegments(i)}
                                  // ⚠️ 这个按钮是**必经之路**，不是可选项：不点它就上传会被
                                  // 拦下（见 uploadOne 里的同源判据），因为「共 N 段」而传出去
                                  // 一份，等于把用户确认过的分段结果整个丢掉。
                                  // ⚠️ `segBusy` 不能漏：拆分**会改变 files 的长度**，而分段
                                  // 的 worker 手里攥着点击那一刻的下标 —— 两份合订谱一起跑时，
                                  // 先跑完的那份被拆开，另一份的结果就会写进**它的某一段**，
                                  // 而那份自己永远停在「识别中」。同一文件里「确认上传」与
                                  // 「识别分段」都带了 `segBusy`，这里必须一致。
                                  // ⚠️ `hasAnalyzingFiles` 同理，且是**逐行重试**带出来的新缺口：
                                  // 重试是确认阶段第一个「攥着下标飞行」的长任务，它飞行时
                                  // 这个按钮若可点，结果就会写进别的行、被重试那行永远卡住
                                  // （对抗测试实测：拆出一段后再还原，行集平移一格）。
                                  disabled={phase === "uploading" || segBusy || hasAnalyzingFiles}
                                  className="px-2 py-0.5 text-xs border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
                                  title="按这些边界把文件拆成多行，逐段确认乐器与分声部号；上传时自动切开，不会重复 OCR"
                                >
                                  确认这 {segmentsOf(f).length} 段
                                </button>
                              )}
                            </div>
                          )}
                          {!(f.instrumentEdit ?? f.instrumentGuess ?? "").trim() && (
                            <p className="text-xs text-warning">未识别出乐器，请先填写再上传</p>
                          )}
                          {/* 拦截提示与上传失败原因都落在这里 —— 行状态可能仍是 analyzed */}
                          {f.error && <p className="text-xs text-danger">{f.error}</p>}
                        </div>
                      )}

                    {/* 死胡同行的**唯一出路**。这一块必须在编辑器那道门**之外**：
                          「首次分析就失败」的行没有 `instrumentGuess`，门内的一切
                          （编辑器、以及那行红字）都不渲染。
                          ⚠️ 但**失败原因仍然看得见** —— 标题行的 `statusText` 就是
                          `失败: <原因>`，且 `statusColor` 给 error 的是 `text-danger`。
                          所以这里**不再重复渲染一遍原因**（那会同一句话出现两次），
                          只补上原先完全缺失的东西：**一个能点的按钮**。
                          出现在两类行上：**首次分析就失败**的错误行（没有识别结果，
                          有识别结果的上传失败行走「确认上传」那条路，这里不重复给），
                          以及**分析完了但没认出乐器**的行（见 `isUnidentified`）。
                          前者是死胡同，后者只是「模型说不知道」—— 后者编辑器是渲染着的，
                          用户也可以直接手填。
                          `disabled` 带上 `segBusy` 与 uploading：飞行中的闭包攥着
                          `{f, i}` 下标，这时候挪动行集会把结果写进别的行（同「确认这 N 段」
                          那个按钮上写的理由。**别在这里写行号** —— 本目录既有约定
                          （见 `sub-parts.ts` 与 `sections.ts` 里都写过的那句），
                          它随改动漂走，而且本分支已经把它飘错过一次）。 */}
                    {((f.status === "error" && f.instrumentGuess === undefined) ||
                      isUnidentified(f)) && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => retryRow(i)}
                          disabled={phase === "uploading" || segBusy}
                          className="px-2 py-0.5 text-xs border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
                          title="重新跑这一份的分析（取页 → OCR → 识别）。只重烧这一份的配额，其余行不受影响。同一输入两次结果不同时也可以点它。"
                        >
                          重试
                        </button>
                      </div>
                    )}
                  </div>

                  {expandedIdx === i && hasDetails(f) && (
                    <div className="border-t border-border px-3 py-2 text-xs space-y-2 bg-muted/30">
                      {f.preview && (
                        <div>
                          <span className="font-medium text-text-muted">
                            送检图像{f.sourcePage ? `（第 ${f.sourcePage} 页）` : ""}：
                          </span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f.preview}
                            alt="送去 OCR 的图像"
                            className="mt-1 w-40 border border-border rounded"
                          />
                        </div>
                      )}
                      {f.cropNote && <p className="text-text-muted">{f.cropNote}</p>}
                      {/* 弃权原因：**排查用**，所以给的是后端那个 slug 而不是编一句人话 ——
                          它要与后端日志对得上。用户能照做的那句话在状态行上（「需人工确认」）。
                          ⚠️ 措辞必须是**过去式**、而且不能加「这一行未识别」之类的当下判断
                          （对抗测试实测）：用户按提示手填之后这一行已经识别了，句子里那句
                          「未识别原因」就成了假话；而**段级弃权**的行更特别 —— 它继承着源行的
                          乐器名（状态行显示「已识别」），这时把原因藏起来恰恰会丢掉最需要它的
                          那种情形。所以只陈述「上一次识别后端弃权了」这个**事实**。 */}
                      {f.abstainReason && (
                        <p className="text-text-muted">上一次识别后端弃权：{f.abstainReason}</p>
                      )}
                      {f.warning && <p className="text-warning">{f.warning}</p>}
                      {f.ocrText && (
                        <div>
                          <span className="font-medium text-text-muted">OCR 文本：</span>
                          <pre className="mt-1 p-2 bg-muted border border-border rounded text-text max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                            {f.ocrText}
                          </pre>
                        </div>
                      )}
                      {f.llmResult && (
                        <div>
                          <span className="font-medium text-text-muted">LLM 结果：</span>
                          <p className="mt-1 text-text">{f.llmResult}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              {/* 分段**不自动跑**：一份 N 页的合订谱要烧 N 次 OCR，而免费档是 500 次/天/IP。
                  所以这个按钮把代价写在脸上（#290 验收标准：调用次数在导入前可见）。
                  ⚠️ 不打 `mr-auto`：操作行按 #182 一律靠右下角，不许左右两端分布。 */}
              {segTargets.length > 0 && !allDone && (
                <button
                  onClick={startSegmentation}
                  // ⚠️ **`hasAnalyzingFiles` 不能少**（2026-09-25）：切点判出后这个函数会
                  // **自动拆行**，而拆分改变 `files` 长度 —— 逐行重试恰是「攥着下标飞行」的
                  // 长任务，行集一平移，重试结果就写进别的行、被重试那行永远停在「分析中」
                  // →`hasAnalyzingFiles` 恒真 →「确认上传」永久禁用。
                  // 与「还原为一份」「确认这 N 段」两处是同一条纪律（不在注释里写行号 ——
                  // 它们每改一次就腐烂一次，本行自己就烂过一次）。
                  // 改动前这个按钮只写 `segState`、不动行集，所以漏了它也不会出事。
                  disabled={
                    phase === "analyzing" || phase === "uploading" || segBusy || hasAnalyzingFiles
                  }
                  className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50"
                  title="合订谱里可能装着好几份分谱。识别出边界后会直接拆成几份，各自识别、各自上传。"
                >
                  {segTargets.some(({ f }) => f.segState === "running")
                    ? "识别分段中..."
                    : `识别分段（${segTargets.length} 份，约 ${segCost} 次 OCR）`}
                </button>
              )}
              <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text">
                {phase === "analyzing" ? "取消分析" : "取消"}
              </button>
              {/* 分析期间就把「确认上传」显示出来、但禁用：让用户看得见终点在哪、
                  还差几个文件，而不是对着一个转圈图标猜还要等多久。 */}
              {phase === "uploading" ? (
                <button
                  disabled
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg opacity-50"
                >
                  {/* ⚠️ 转圈而不是「…」（用户实测反馈）：省略号是**静止**的，看不出还在动 ——
                      上传十几份谱要等一会儿，静止的三个点读起来就是「卡住了」。
                      用 `admin/layout.tsx` 守护页那套纯 CSS 转圈（border + animate-spin），
                      不引图标依赖。颜色取 `border-primary-foreground`，与本按钮的前景色一致。 */}
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent shrink-0"
                    />
                    上传中
                  </span>
                </button>
              ) : allDone ? (
                // 干完了就给一个**正向出口**：全部传完后还显示禁用的「确认上传（0/N）」
                // 会让用户以为没成功，而唯一能点的是「取消」。
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                >
                  完成（已上传 {doneCount} 个）
                </button>
              ) : (
                <button
                  onClick={confirmUpload}
                  // ⚠️ `refiningCount` 不能漏：段级识别还在飞时上传，`uploadOne` 会按
                  // 点击那一刻的行算出**没号**的 `file_name` / `sub_parts` 落库，
                  // 而屏幕上那几秒后就有号了 —— 界面与库从此对不上且没人回退（见 `refiningCount`）。
                  disabled={
                    phase === "analyzing" ||
                    uploadableCount === 0 ||
                    hasAnalyzingFiles ||
                    segBusy ||
                    refiningCount > 0
                  }
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {/* 灰着必须给理由：段级识别在飞时那几行看起来是「已识别、可直接传」的
                      （它们继承了源行的乐器名），只灰不说是本文件明确反对的写法。
                      同一文件里「识别分段」用的也是这个「动词中...」的写法。 */}
                  {refiningCount > 0
                    ? "识别各段中..."
                    : `确认上传（${uploadableCount}/${files.length}）`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
