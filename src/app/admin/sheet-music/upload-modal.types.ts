/**
 * `upload-modal.tsx` 里的数据形状（拆 god file 的第一步：**只搬声明，零运行时改动**）。
 *
 * 为什么先搬类型：后面几步（抽纯函数、抽分析/分段链路）的函数签名里全是这些类型，
 * 类型留在原地就没法把函数搬出去。搬类型本身不改变任何运行时行为 —— `pnpm typecheck`
 * 加上现有测试就能验证这一点。
 *
 * ⚠️ **注释跟着类型走**：下面这些说明（尤其 `LlmAnalysis` 的『「信号类」字段的消费者清单』
 * 与「为什么这些字段都写成可选」）是这个仓库反复栽过跟头换来的，别在搬家时顺手删。
 */

export interface UploadFile {
  file: File;
  originalName: string; // 原始文件名，展示用；上传文件名由 generateFileName 生成
  status: "pending" | "analyzing" | "analyzed" | "uploading" | "done" | "error";
  error?: string;
  /** 声部（闭集，写进 `sheet_music_parts.section`，详情页按它分组、也按它排序） */
  sectionGuess?: string;
  sectionEdit?: string;
  /**
   * 主声部之外，这份谱**还要落到**哪几个声部（后端 `Analysis.extraSections`）。
   *
   * 只有「一个分部、跨两个声部、又不能切」的谱才有（`Violoncello e Basso` 那种共用分谱，
   * 见 `sections.ts` 的说明）。上传时一份文件会**落成两行**，**每行各自一个存储对象**。
   *
   * ⚠️ `Guess` 缺省是 `undefined` 而不是 `[]`，与 `sectionGuess` 一样：**字段缺失必须与
   * 「没有额外声部」等价**（口径见 `LlmAnalysis` 的「为什么这些字段都写成可选」）。
   * 取值一律走 `editsOf`（实现不在本文件），别就地写 `?? []` —— 「三处各抄一份推导式」的跟头
   * 已经栽过一次，别再抄第四份。
   */
  extraSectionsGuess?: string[];
  /** 用户增删过的额外声部。`undefined` = 没动过（用 Guess） */
  extraSectionsEdit?: string[];
  /** 中文乐器名（开集，写进 sheet_music_files.instrument，也是文件名主干的来源） */
  instrumentGuess?: string;
  instrumentEdit?: string;
  subPartsGuess?: number[];
  /**
   * 输入框里的**原文**（而不是解析后的数组）—— 存这个是因为受控输入不能存解析结果：
   * 用户敲 `1,` 的瞬间解析结果是 `[1]`，回填成 `"1"` 会把刚敲的逗号吃掉，
   * `1,2` 永远敲不出来。原文为 `undefined` = 没编辑过（用 Guess）。
   */
  subPartsEditText?: string;
  /**
   * 模型**给了**号但后端一个都没解析出来时，模型用的那个写法（`Analysis.subPartsRaw`）。
   *
   * ⚠️ 叫「写法」不是「原文」：后端 `describeRaw` 拿到的值已经过了 `JSON.parse`，
   * 超长整数会丢精度、非有限数只剩一个名字（后端注释里明说过「前端别拿它当原文用」）。
   * 它是**给用户看的线索**，不是模型的原话 —— 文案里也别承诺「原文」。
   *
   * 这一行**会被拦下**（见 `uploadBlocker` 的 `subPartsUnread`）：光提示不够，
   * 用户不填就点上传的话，号会连着文件名一起静默丢掉。
   */
  subPartsRaw?: string;
  /**
   * 后端返回的号**超过前端上界**的个数（`overSubPartsCap`）。仅用于给一句提示 ——
   * 这种情况今天不可达，它防的是两个仓库的 `MAX_SUB_PARTS` 漂移。
   */
  subPartsOverCap?: number;
  /**
   * 模型给的声部**原值**（`Analysis.sectionRaw`），落在闭集外时才有 —— 见 `LlmAnalysis`。
   *
   * ⚠️ 它**不是用户可编辑字段**（没有 Edit/Guess 两态，所以 `editsOf` 里没有它）：
   * 唯一来源是 `runLlmAnalysis` 那次映射，读法就是 `f.sectionRaw`（`sectionWarning`）。
   */
  sectionRaw?: string;
  /**
   * 后端为什么弃权（`Analysis.abstainReason`）—— 展开面板里的一行诊断，见 `LlmAnalysis`。
   */
  abstainReason?: string;
  /**
   * 存储键里那一段 id。**每行生成一次、重试复用**，这样失败重传走 `upsert`
   * 覆盖同一个对象，不会留下一堆孤儿文件。
   *
   * ⚠️ **那句话只在「落点集不变」时成立**。跨声部的行按**落点位置**派生路径
   * （`${storageId}-k`，见 `uploadOne`），所以「先传成功、批量 insert 失败、用户又
   * 把落点数改小、再重试」这一串之下，多出来的那个对象（`-1`）没人引用 —— 而详情页
   * 所有删除路径都是**按行枚举对象**的，从界面上删不掉它（只能到 Storage 后台清）。
   * 概率极低、后果只是桶里多一个看不见的对象，所以先如实记着而不是加一套清理逻辑；
   * 要根治就让路径带**落点身份**而不是位置（例如声部的短哈希），那样增删落点都不会挪动别人。
   */
  storageId?: string;
  /** 这一份 PDF 的总页数。分析时顺手记下 —— 成本估算与「要不要分段」都看它 */
  pageCount?: number;
  /**
   * 分段（#290 Step 1）。只有多页、且非总谱的文件才走这条路。
   *
   * `pageTexts` 与 `segmentStarts` 都要留着：用户改边界时**不重跑 OCR**
   *（验收标准点名的「改正后不重复 OCR」就是靠这两个字段）。
   */
  /**
   * **这一段自己首页**的窄带 OCR 文本（切分时从源行的 `pageTexts` 里取）。
   *
   * ⚠️ 只在段行上有。用途是让每段用**自己的**第一页重新识别一次 —— 合订谱恰恰是
   * 「每段不一样」的（`Piccolo,_Flute_1,_2.pdf → [4,10]`：前 3 页短笛、中间长笛 1、
   * 最后长笛 2），而这份文本在分段那一步**已经 OCR 过**，所以各跑一次是
   * **N 次 LLM、0 次 OCR**。取不到（那一页 OCR 失败）时保留继承来的判断。
   */
  segHeadText?: string;
  /** 模型据以判断的原文 + 它有没有在原文里找到。见 `LlmAnalysis` 里同名字段的说明。 */
  evidence?: string;
  evidenceFound?: boolean;
  /** 引文只在**文件名**里找得到（不在页面上）。见 `LlmAnalysis.evidenceFromFileName`。 */
  evidenceFromFileName?: boolean;
  segState?: "running" | "done" | "error";
  segError?: string;
  /**
   * 逐页窄带 OCR 的**成功**结果。失败的页不在这里（见 `segFailedPages`）。
   *
   * 失败重试与「改边界」都复用它 —— 有它就不再重烧那几页的 OCR（验收标准点名的
   * 「改正后不重复 OCR」靠这个；`runSegmentation` 的重试也靠它）。
   */
  pageTexts?: PageText[];
  /** 窄带 OCR 失败的页号（1-based）。全失败时 `segState` 直接是 `error`，不会走到这里 */
  segFailedPages?: number[];
  /**
   * 各段的**起始页**（恒含第 1 页，严格升序）。用户拖动边界 = 改这个数组。
   * `undefined` = 还没跑过分段；`[1]` = 明确不切（整份一段）。
   *
   * ⚠️ 它与渲染出来的段**逐位对应**，所以下标绝不能被过滤打乱 —— 否则用户改的是
   * 第 3 段、落到的却是第 2 段（见 `segmentStartText` 的说明）。
   */
  segmentStarts?: number[];
  /**
   * 边界输入框里的**原文**，与 `segmentStarts` 逐位对应（第 0 位恒为 "1"，没有输入框）。
   *
   * ⚠️ **存原文而不是解析结果**，理由与 `subPartsEditText` 逐字相同：受控输入取派生值
   * 的话，打字过程中的中间态会被当成完整值提交。段起点这里更凶 —— 中间态一旦落进
   * `normalizeSegments`（语义是 filter），那个边界会被**当成重复值合并掉**，一段就此
   * 消失，而恢复只能重跑整个分段 = 再烧 N 次 OCR。所以：中间态只停在框里，
   * 提交（失焦/回车）时才解析，且**非法值一律不提交**（`parseBoundaryText` 返回 null）。
   */
  segmentStartText?: string[];
  /**
   * 这一行是**合订谱切出来的一段**（#290 Step 2）。有它 = 上传时只取这几页。
   *
   * 同一份源文件切出来的若干行共享一个 `groupId`：界面上它们各占一行、各有各的
   * 乐器/号/声部，而上传时**源文件只 load 一次**（见 `confirmUpload` 的单元划分）——
   * 逐行各 load 一次会让峰值变成 N 倍源文件，正是探针要防的形状。
   */
  splitOf?: {
    groupId: string;
    /** 源文件里的页区间（1-based 闭区间） */
    from: number;
    to: number;
    segIndex: number;
    segTotal: number;
  };
  ocrText?: string;
  llmResult?: string;
  preview?: string; // 实际送去 OCR 的那张图的缩略图（排查用）
  sourcePage?: number; // 取的是第几页
  warning?: string; // 非致命问题（某页图像解码失败、OCR 失败等），不影响继续靠文件名识别
  cropNote?: string; // 裁切决策回显（裁到哪 / 为什么没裁），排查「切错位置」用
}

export interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  scoreId: string;
  onUploaded: () => void;
}

/** 一页要依次送给 OCR 的图。`full` = 这是整页（回退项），不是标题区 */
export interface PageAttempt {
  base64: string;
  full: boolean;
  note: string;
}

/** 一页的渲染结果 + 它的页号/总页数（取页游走时由 walker 补上） */
export interface RenderedPage {
  base64: string; // 送去 OCR 的图（裁切条优先）
  fullBase64: string; // 整页图，裁切条读不到文字时回退用
  preview: string;
  fullPreview: string; // 整页缩略图，回退整页时顶替 preview
  pageNo: number;
  /** 这一份 PDF 的总页数 —— 成本估算与「要不要分段」都看它，顺手带出来省一次解析 */
  pageCount: number;
  cropNote: string; // 裁切决策回显，便于排查「切错位置」
  cropped: boolean; // base64 是否真的是裁切条
}

/** 一页的窄带文本（分段用）。页码 1-based，与 PDF 页序一致。 */
export interface PageText {
  page: number;
  text: string;
}

/**
 * 后端响应里**「信号类」字段的消费者清单**（pkuso-web#302）。
 *
 * 后端为了「把静默差异变成可见信号」专门发这些字段；前端不读就等于它们不存在，
 * 而后端会以为已经交代过了。这类漏接**已经发生过多次**（`evidence`、`sectionRaw` 各一次），
 * 所以把清单钉在这里：**新增信号字段时，这一块要一起改**。
 *
 * - `subPartsRaw` → `subPartsNotice`（行内提示）+ `uploadBlocker`（拦下）
 * - `subPartsOverCap` → `subPartsNotice`（上界漂移的维护者提示）
 * - `evidence` → `evidenceLine`（显示依据）
 * - `evidenceFound` → `evidenceWarn`（警示色）
 * - `evidenceFromFileName` → `evidenceLine`（「来自文件名」那一态）
 * - `sectionRaw` → `sectionWarning`（两仓声部词表漂移的**唯一**可见信号）
 * - `abstainReason` → 展开面板的「上一次识别后端弃权」（排查用）
 * - `isFullScore` → `isFullScoreRow`（声部落总谱、不进分段）
 * - `extraSections` → `editsOf().extraSections`（一份谱落成几行）
 *
 * ⚠️ 注意「算了但没写进行状态」也是漏接的一种形态：`analyzeOne` / `refineSegmentsInner`
 * 是**逐字段**构造 `UploadFile` 的（不是 spread），中间少写一个字段，展示代码就成死代码
 * —— `subPartsOverCap` 栽过这一次（它自己的注释里记着：审查靠「提示可达性」的探针抓出来的）。
 *
 * ## 为什么这些字段都写成可选
 *
 * 与「线上后端是新是旧」无关：这些字段注释此前写的是「旧后端不返回 → 平滑降级」，那套口径**已经作废**
 * （那是两仓字段还没对齐时留下的写法，会让人误以为这些 `undefined` 是临时兼容层），
 * 一律按这一段理解。
 *
 * 理由是响应**是 `any`**（`functions.invoke` 的返回值），谁也不能保证形状 ——
 * 「这个字段没来」是这条链路上一等的可能状态，代码必须活得下去。
 *
 * **可选信号字段的缺失不在边界上归一**：映射那一步用 `typeof` 判型 —— 缺字段保持
 * `undefined`，不在那里顺手归一成 `false` / 空串；「这两种要不要显示成同一件事」交给
 * 界面决定。`evidence`（缺字段 = 什么都不显示 / 空串 = 提示「模型没给引文」）与
 * `evidenceFound`（缺字段 = 不提示 / `false` = 警示）就是**不等价**的例子，所以那几处
 * `typeof` 判型**不是兼容层，别顺手删** —— 归一掉之后 `undefined` 就被吃掉了，
 * 上面那两处再也分不开。
 *
 * ⚠️ 那些 `typeof` 字段里**只有 `evidence` / `evidenceFound` 这两处是承重的**：其余几处
 * （`subPartsRaw` / `sectionRaw` / `abstainReason` / `evidenceFromFileName`）在界面上只做真值
 * 判断，缺字段与 `""` / `false` 落在同一支。它们仍然保持 `typeof`，是为了**别让「哪几处承重」
 * 变成每次都要重新判断的事** —— 承重的那两处一旦被顺手归一，区别就再也回不来了。
 *
 * ⚠️ **别把它当普适规则：同一个 `return` 里的其余字段各有既定含义**（判据是「界面上等价吗」，
 * 不是「有没有判型」）—— 多数是「缺了就归一」，也有像 `subPartsOverCap` 那样本就不归一的：
 * - `section` / `instrument` / `subParts`：缺了就取默认（`String(data.x ?? …)` / `sanitizeSubParts`）；
 * - `isFullScore`：`=== true`，缺字段 → `false` —— 「只有恰好 true 才算总谱」本身就要归一；
 * - 反方向的 `extraSections` / `UploadFile.extraSectionsGuess`：**按设计「缺席 ≡ 空」**，
 *   所以那两处统一 `?? []` 是**对的**；
 * - `subPartsOverCap`：判据在函数里（`overSubPartsCap(…) ?? undefined`）—— 缺字段同样是
 *   `undefined`（与那六个同类，只是写法不是 `typeof`；它**不**归一到某个值）。
 */
export interface LlmAnalysis {
  section: string;
  instrument: string;
  subParts: number[];
  /**
   * 模型给的声部**原值**（后端 `Analysis.sectionRaw`）：它落在两仓约定的闭集之外时才有，
   * 此时 `section` 已被后端折成「其他」。
   *
   * ⚠️ **它必须有消费者**（pkuso-web#302）：后端 prompt 里的声部词表与前端
   * `INSTRUMENT_ORDER` 是两份手抄副本，没有同步机制 —— 这个字段就是漂移的**唯一**信号。
   * 而漂移后的落库值（「其他」）本身是合法的，只看 `section` 的话漂移**完全不可见**。
   */
  sectionRaw?: string;
  /**
   * 后端**为什么弃权**（`Analysis.abstainReason`，如 `empty-instrument` /
   * `instrument-illegal-chars`）。
   *
   * ⚠️ 与「模型没给出乐器」**不是一回事**：弃权可能是「模型说了、但我们拒了」
   * （名字里含不能用于文件名的字符、超长）。两者的界面后果都是「需人工确认」，
   * 但排查时该看的地方不同，所以它是展开面板里的诊断信息（与 `cropNote` 同一类），
   * 不是给用户照做的一句话。
   *
   * ⚠️ **可选**：字段缺失 → 面板里不显示这一行。
   */
  abstainReason?: string;
  /** 模型给了号但后端没解析出来时，模型用的那个写法，见 UploadFile.subPartsRaw */
  subPartsRaw?: string;
  /** 后端给的号超过前端上界时的个数，见 UploadFile.subPartsOverCap */
  subPartsOverCap?: number;
  /**
   * 后端判出这是**总谱**（pkuso-backend#26）。总谱不是声部，而是「整份都在里面」：
   * 声部落「总谱」、号清空，且**不参与分段**（`segEligible` 对总谱恒 false）——
   * 分段里最贵的一笔就是总谱，而它今天只能靠人工标记（人工标记要等分段跑完才做得出）。
   */
  isFullScore: boolean;
  /**
   * 主声部之外还要落到哪几个声部（pkuso-backend 的 `Analysis.extraSections`）。
   *
   * ⚠️ **可选**：字段缺失时语义上等于「没有额外声部」—— 这是**按设计「缺席 ≡ 空」**的
   * 那类（口径见上文的「为什么这些字段都写成可选」）。所以取值一律走
   * `editsOf().extraSections`（那里统一 `?? []`），别在调用点各写各的。
   */
  extraSections?: string[];
  /**
   * 模型据以判断的那段原文（后端 `Analysis.evidence`）。
   *
   * ⚠️ **可选**（缺字段时界面**什么都不显示**，见下）：它的用途是**让用户一眼复核模型的依据** ——
   * prompt 里对模型的承诺就是这句（「让用户一眼就能复核你」），前端不显示的话
   * 那个承诺是空的。它也是 `evidenceFound === false` 时用户唯一能据以判断的东西。
   */
  evidence?: string;
  /**
   * 后端在原文里**找到了**这段引文吗（`Analysis.evidenceFound`，2026-09-25 新增）。
   *
   * ⚠️ 这是**信号，不是门** —— `false` 时答案照用，只是要提示用户核对。
   * **可选**：字段缺失 → `undefined` → 不提示；**但不要把它当成 `false`** —— 二者不等价。
   *
   * ⚠️ **它必须有消费者**：后端删掉「证据弃权门」的唯一依据就是「交给前端提示用户核对」。
   * 没人读的话，那批改动的净效果是「预填一个可能错的答案 + 显示成已识别」，**降一道防线**。
   */
  evidenceFound?: boolean;
  /**
   * 引文**只在文件名里**找得到（后端 `Analysis.evidenceFromFileName`，2026-09-26 新增）。
   *
   * 与 `evidenceFound` 分开，是因为「引文来自文件名」和「引文哪儿都没找到」是**两件事**：
   * 出版社扫描分谱的乐器名常印在文件名里（页面 OCR 是乱的），那时抄文件名是正当依据 ——
   * 但用户该知道该去看哪儿核对（页面上找不到，得看文件名）。
   *
   * ⚠️ **可选**：字段缺失 → `undefined` → **不进「来自文件名」那一支**，落到 `evidenceFound`
   * 决定的那两句之一（所以「`evidence` 非空 + `evidenceFound === false` + 缺这个字段」时
   * 显示的是「未在原文中找到，请核对」那一句，不是「普通依据」）。
   */
  evidenceFromFileName?: boolean;
}

/**
 * 弹窗的阶段。**类型只定义在这一处** —— 凡是拿 phase 做判断的地方（父组件的 `useState`、
 * 子组件的 props）都该 import 它，**别再抄字面量**：抄出来的那份自己不会跟着变，
 * 提醒你的是 `tsc` 在「把值喂进 prop」那一侧报的错 —— 喂进去的那个值要是也抄的，就没人会报。
 */
export type UploadPhase = "select" | "analyzing" | "confirm" | "uploading";
