/**
 * 列表里的一行（卡片）：状态行、乐器/声部/号的编辑、分声部提示、分段块、展开后的排查面板。
 *
 * ⚠️ **判据一个都不在这里**：文案与判据在 `../row-text`（那一批是纯函数，直接从那儿 import），
 * 组级查询与 handler 由父组件传进来（它们读 `files`/`setFiles`，搬不走）。
 * 本仓栽过「同一条判据有几份拷贝，只有一份有测试」的跟头 —— 这里只负责**渲染**。
 *
 * ⚠️ `expanded` 是父组件算好的（`expandedIdx === i`）：行卡片不需要知道「哪一行展开着」这个机制。
 */

import { ChevronDown, ChevronRight, X } from "lucide-react";
import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from "@/constants/instruments";
import type { UploadFile, UploadPhase } from "../upload-modal.types";
import {
  canHaveExtraSections,
  costOf,
  editsOf,
  evidenceLine,
  evidenceWarn,
  hasDetails,
  isFullScoreRow,
  isKnownSection,
  isUnidentified,
  previewPath,
  sectionWarning,
  segEligible,
  segmentsOf,
  startTextOf,
  startsOf,
  statusColor,
  statusText,
  subPartsNotice,
  unsplitSegments,
} from "../row-text";
import { MAX_EXTRA_SECTIONS } from "../sections";
import { formatSubParts } from "../sub-parts";
import { SegmentBlock } from "./segment-block";
import { DetailsPanel } from "./details-panel";

type FileRowProps = {
  f: UploadFile;
  i: number;
  phase: UploadPhase;
  /** 这一行是不是展开着（父组件算好的 `expandedIdx === i`）—— 行卡片不需要知道 expandedIdx 这个机制 */
  expanded: boolean;
  onToggleExpand: () => void;
  segBusy: boolean;
  hasAnalyzingFiles: boolean;
  /* ↓↓ 组级查询（读 `files`，所以留在父组件） */
  canUnsplit: (groupId: string) => boolean;
  unsplitGroup: (groupId: string) => void;
  duplicatedInGroup: (groupId: string) => Set<number>;
  /* ↓↓ handler（都闭包了组件状态，一律父组件传进来；不许在这里重写） */
  onUpdateFile: (
    index: number,
    patch: Partial<UploadFile> | ((f: UploadFile) => Partial<UploadFile>),
  ) => void;
  onRetryRow: (i: number) => Promise<void>;
  onInstrumentChange: (index: number, value: string) => void;
  onSectionChange: (index: number, value: string) => void;
  onAddExtraSection: (index: number, value: string) => void;
  onRemoveExtraSection: (index: number, value: string) => void;
  onSubPartsChange: (index: number, value: string) => void;
  onSegmentStartRawChange: (index: number, segIndex: number, raw: string) => void;
  onCommitSegmentStart: (index: number, segIndex: number) => void;
  onMergeSegment: (index: number, segIndex: number) => void;
  onSplitSegment: (index: number, segIndex: number) => void;
  onSplitIntoSegments: (index: number, freshRow?: UploadFile) => void;
};

export function FileRow({
  f,
  i,
  phase,
  expanded,
  onToggleExpand,
  segBusy,
  hasAnalyzingFiles,
  canUnsplit,
  unsplitGroup,
  duplicatedInGroup,
  onUpdateFile,
  onRetryRow,
  onInstrumentChange,
  onSectionChange,
  onAddExtraSection,
  onRemoveExtraSection,
  onSubPartsChange,
  onSegmentStartRawChange,
  onCommitSegmentStart,
  onMergeSegment,
  onSplitSegment,
  onSplitIntoSegments,
}: FileRowProps) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {hasDetails(f) ? (
            <button
              onClick={() => onToggleExpand()}
              // 图标按钮必须有无障碍名（也可以被测试直接取到 —— 展开面板里的
              // 诊断信息此前没有任何用例能触达，见 pkuso-web#302）
              aria-label={expanded ? "收起详情" : "查看详情"}
              aria-expanded={expanded}
              title={expanded ? "收起详情" : "查看详情"}
              className="shrink-0 text-text-muted hover:text-text"
            >
              {expanded ? (
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
        {(f.status === "analyzed" || f.status === "error") && f.instrumentGuess !== undefined && (
          <div className="space-y-1.5 pl-5 border-l border-border">
            {/* 切分出来的行：说清它是**哪几页**（否则几行长得一模一样，
              用户没法把屏幕上的行和谱子上的段对上），并给一条退回的路 */}
            {f.splitOf && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-primary shrink-0">
                  第 {f.splitOf.segIndex + 1}/{f.splitOf.segTotal} 段 · 源文件第 {f.splitOf.from}–
                  {f.splitOf.to} 页
                </span>
                <button
                  onClick={() => unsplitGroup(f.splitOf!.groupId)}
                  // ⚠️ `hasAnalyzingFiles` 与下面「确认这 N 段」是同一条理由：
                  // 这个按钮**会改变 files 的长度**，而分析 worker（含逐行重试）
                  // 手里攥着点击那一刻的下标 —— 重试飞行中还原一份，会让结果
                  // 写进**别的行**、被重试那行永远停在「分析中」。
                  // 见 `onRetryRow` 的说明与本文件里 `segBusy` 的同类教训。
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
              <p className="text-xs text-danger">与同组的其他段重名 —— 请改乐器名或分声部号</p>
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
                onChange={(e) => onSectionChange(i, e.target.value)}
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
                <option value={OTHER_INSTRUMENT_GROUP}>{OTHER_INSTRUMENT_GROUP}</option>
                {/* 总谱**必须能选**：它不是声部（见 instruments.ts），
                  但「总谱不参与切分检测」是用户定的、也是省 OCR 最大的一笔，
                  而总谱认不出来（三个本地判据都被实测否掉）——人工标记是
                  唯一入口。选不到它 = 那条分支永远走不到，还不是死代码
                  那么轻：用户会以为总谱已经被排除了。 */}
                <option value={FULL_SCORE_SECTION}>{FULL_SCORE_SECTION}</option>
              </select>
              <label className="text-xs text-text-muted w-12 shrink-0 ml-1">乐器</label>
              <input
                type="text"
                value={f.instrumentEdit ?? f.instrumentGuess ?? ""}
                onChange={(e) => onInstrumentChange(i, e.target.value)}
                placeholder="乐器名"
                disabled={phase === "uploading"}
                className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-26 shrink-0 disabled:opacity-50"
              />
              <label className="text-xs text-text-muted w-12 shrink-0 ml-1">分声部</label>
              <input
                type="text"
                // 总谱没有「第几号」：框里直接显示「总谱」并禁用，
                // 比留一个填什么都说不通的输入框清楚
                value={
                  isFullScoreRow(f)
                    ? FULL_SCORE_SECTION
                    : (f.subPartsEditText ?? formatSubParts(f.subPartsGuess ?? []))
                }
                onChange={(e) => onSubPartsChange(i, e.target.value)}
                placeholder="号，如 1,2"
                disabled={phase === "uploading" || isFullScoreRow(f)}
                title={isFullScoreRow(f) ? "总谱是整份，没有分声部号" : "分声部号，如 1,2"}
                className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-16 shrink-0 disabled:opacity-50"
              />
              {/* 「没有号」——**逃生口**，只在模型给了号却没读懂时出现。
                没有它的话 `../row-text` 的 `uploadBlocker` 那道拦截会把人锁死：那种状态下
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
                    onClick={() => onUpdateFile(i, { subPartsEditText: "" })}
                    disabled={phase === "uploading"}
                    className="px-1.5 py-0.5 text-xs text-text-muted border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
                    title="这份谱子确实没有分声部"
                  >
                    没有号
                  </button>
                )}
              <button
                onClick={() =>
                  onUpdateFile(i, {
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
              能不能有，判据是 `canHaveExtraSections` —— 与 `../sections` 的 `normalizeExtraSections`
              **同源**（总谱与「其他」都不能）。
              「+」这个入口是**必需的**，不是锦上添花：模型对这个字段的稳定性
              与别的字段一样（#298 记着答案非确定性），判漏时用户得有办法手工补，
              否则这份谱就永远只归一个声部、而低音提琴组根本看不到它。
              选项里排除已选的：选了也进不去（清洗会去重），留着只会让人以为没生效。 */}
            {!canHaveExtraSections(f) && editsOf(f).section === OTHER_INSTRUMENT_GROUP && (
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
                      onClick={() => onRemoveExtraSection(i, s)}
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
                      if (e.target.value) onAddExtraSection(i, e.target.value);
                    }}
                    disabled={phase === "uploading"}
                    className="px-1 py-0.5 text-xs bg-muted border border-border rounded shrink-0 disabled:opacity-50"
                    title="一份谱同时属于两个声部时（如 Violoncello e Basso 是大提琴与低音提琴共用），在这里加上第二个声部；上传时这份文件会同时出现在两个声部里，各自存一份（删掉其中一个不影响另一个）。"
                  >
                    <option value="">+ 声部</option>
                    {INSTRUMENT_ORDER.filter(
                      (s) => s !== editsOf(f).section && !editsOf(f).extraSections.includes(s),
                    ).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {sectionWarning(f) && <p className="text-xs text-warning">{sectionWarning(f)}</p>}
            {subPartsNotice(f) && <p className="text-xs text-warning">{subPartsNotice(f)}</p>}
            {evidenceLine(f) && (
              <p className={`text-xs ${evidenceWarn(f) ? "text-warning" : "text-text-muted"}`}>
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
              <SegmentBlock
                f={f}
                i={i}
                phase={phase}
                segBusy={segBusy}
                hasAnalyzingFiles={hasAnalyzingFiles}
                costOf={costOf}
                segmentsOf={segmentsOf}
                startsOf={startsOf}
                startTextOf={startTextOf}
                unsplitSegments={unsplitSegments}
                onSegmentStartRawChange={onSegmentStartRawChange}
                onCommitSegmentStart={onCommitSegmentStart}
                onMergeSegment={onMergeSegment}
                onSplitSegment={onSplitSegment}
                onSplitIntoSegments={onSplitIntoSegments}
              />
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
        {((f.status === "error" && f.instrumentGuess === undefined) || isUnidentified(f)) && (
          <div className="flex justify-end">
            <button
              onClick={() => onRetryRow(i)}
              disabled={phase === "uploading" || segBusy}
              className="px-2 py-0.5 text-xs border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
              title="重新跑这一份的分析（取页 → OCR → 识别）。只重烧这一份的配额，其余行不受影响。同一输入两次结果不同时也可以点它。"
            >
              重试
            </button>
          </div>
        )}
      </div>

      {expanded && hasDetails(f) && <DetailsPanel f={f} />}
    </div>
  );
}
