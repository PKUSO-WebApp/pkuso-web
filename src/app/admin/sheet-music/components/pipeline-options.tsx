"use client";

import { estimateAnalysisOcrCalls } from "../analysis";

/**
 * 选文件阶段左下角那两个开关（#297）＋点火前的代价（#290 的验收标准之一：调用次数在导入前可见）。
 *
 * ⚠️ **必须在点火前可勾**：这两颗开关改的是这一批会烧掉多少 OCR ——「分析总谱」把单份的
 * 最坏成本从 1 次抬到 6 次，「乐谱分段」把整批的成本从「份数」抬到「页数」量级。
 * 摆在这里而不是设置页，是因为这两个数在导入前才算得出来（要等文件名 / 页数都定了）。
 *
 * ⚠️ **开关块与操作行是两块**（调用处把本组件放在操作行**之前**）：`AGENTS.md`
 * 的 #182 定的是操作行一律 `justify-end` 靠右下角、禁止左右两端分布，而窄屏上把开关挤进
 * 那一行还会让按钮组吃掉小半行、把成本行压成好几行。
 */
type PipelineOptionsProps = {
  /** 当前待分析的文件数 —— 成本那一行的自变量 */
  fileCount: number;
  analyzeFullScore: boolean;
  onAnalyzeFullScoreChange: (next: boolean) => void;
  /** #386：勾上 = 这一批分析完自动跑分段。初值见 `AUTO_SEGMENT_DEFAULT` */
  autoSegment: boolean;
  onAutoSegmentChange: (next: boolean) => void;
};

/**
 * 两颗开关的 label 共用同一段类串。
 *
 * ⚠️ 抽成常量不只是顺手：`scripts/check-design-debt.mjs` 的第二个棘轮数的是
 * 「同一段 className 在**全仓**出现几次」（≥3 次就该抽出来），而这段类串正好越过
 * 它的长度门槛。写成 `className={LABEL_CLASS}` 而不是两处字面量之后，
 * 「再加一颗开关」不会把那个数顶上去。
 */
const LABEL_CLASS = "flex items-center gap-2 text-2xl text-text-muted cursor-pointer";

export function PipelineOptions({
  fileCount,
  analyzeFullScore,
  onAnalyzeFullScoreChange,
  autoSegment,
  onAutoSegmentChange,
}: PipelineOptionsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={LABEL_CLASS}>
        <input
          type="checkbox"
          checked={analyzeFullScore}
          onChange={(e) => onAnalyzeFullScoreChange(e.target.checked)}
          className="accent-primary"
        />
        <span title="首页读不出乐器时继续往后看几页，用来认出扉页起排的总谱。单份的 OCR 成本随之上升，见下方数字。">
          分析总谱
        </span>
      </label>
      <label className={LABEL_CLASS}>
        <input
          type="checkbox"
          checked={autoSegment}
          onChange={(e) => onAutoSegmentChange(e.target.checked)}
          className="accent-primary"
        />
        <span title="勾上之后，这一批分析完会自动跑窄带 OCR，把各声部的位置找出来；不勾也能在页脚手点「识别分段」。整批的成本按页数算。">
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
        分析最多 {estimateAnalysisOcrCalls(fileCount, analyzeFullScore)} 次 OCR
        {analyzeFullScore ? "（多数文件 1 次）" : ""}
      </p>
    </div>
  );
}
