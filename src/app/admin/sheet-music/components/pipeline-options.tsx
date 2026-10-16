"use client";

import { estimateAnalysisOcrCalls } from "../analysis";

/**
 * 选文件阶段左下角的三个开关（#297 的两个 + #386 的「分析完直接上传」）。
 *
 * **必须在点火前可勾** —— 它们改的是这一批会烧掉多少 OCR：「分析总谱」把单份的最坏成本
 * 从 1 次抬到 6 次，「乐谱分段」把整批的成本从「份数」抬到「页数」量级。摆在这里而不是
 * 设置页，是因为这两个数在导入前才算得出来（要等文件名/页数都定了）。
 *
 * ⚠️ **开关块必须在操作行之外**（父组件里它是独立的一行），不能塞进操作行做左右两端分布：
 * CLAUDE.md #182 定的是操作行一律 `justify-end` 靠右下角、禁止左右两端分布，
 * 而窄屏上那么放还会让按钮组吃掉小半行，把左边的成本行挤成好几行。
 *
 * 这里**只负责渲染 + 把点击报上去**：三个开关的**判据**都不在这个文件里 ——
 * 「分析完直接上传」的判据在 `../auto-upload.ts`（纯函数，可单测），
 * 另两个的判据就是它们各自的值本身。同一条判据几份拷贝、只有一份有测试，是本仓栽过的坑。
 */
type PipelineOptionsProps = {
  /** 选中的文件数 —— 成本行的分子（它只算份数，页数那笔账在分段的按钮上） */
  fileCount: number;
  analyzeFullScore: boolean;
  onAnalyzeFullScoreChange: (on: boolean) => void;
  autoSegment: boolean;
  onAutoSegmentChange: (on: boolean) => void;
  autoUpload: boolean;
  onAutoUploadChange: (on: boolean) => void;
};

/** 三个开关的 label 逐字一样 —— 抽一份，别抄三遍（设计债棘轮在数重复的 className 串） */
const LABEL_CLASS = "flex items-center gap-2 text-xs text-text-muted cursor-pointer";

export function PipelineOptions({
  fileCount,
  analyzeFullScore,
  onAnalyzeFullScoreChange,
  autoSegment,
  onAutoSegmentChange,
  autoUpload,
  onAutoUploadChange,
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
        <span title="分析完对多页的合订谱跑窄带 OCR，把各声部的位置找出来。整批的成本按页数算。">
          乐谱分段
        </span>
      </label>
      <label className={LABEL_CLASS}>
        <input
          type="checkbox"
          checked={autoUpload}
          onChange={(e) => onAutoUploadChange(e.target.checked)}
          className="accent-primary"
        />
        <span title="整批收尾后自动走「确认上传」，不用再手点一次。没认出乐器（弃权）的行永不自动传；分段还开着而某几份没跑分段时也不传，等分段跑完或把分段关掉。">
          分析完直接上传
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
