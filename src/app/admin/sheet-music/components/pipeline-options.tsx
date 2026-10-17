"use client";

/**
 * 选文件阶段左下角那两个开关（#297）。
 *
 * ⚠️ **必须在点火前可勾**：这两颗开关改的是这一批会烧掉多少 OCR ——「分析总谱」把单份的
 * 最坏成本从 1 次抬到 6 次，「乐谱分段」把整批的成本从「份数」抬到「页数」量级。
 * 摆在这里而不是设置页，是因为这两颗开关必须在点火前定下来 —— 分析一开跑就晚了。
 *
 * ⚠️ **开关块与操作行是两块**（调用处把本组件放在操作行**之前**）：`AGENTS.md`
 * 的 #182 定的是操作行一律 `justify-end` 靠右下角、禁止左右两端分布，而窄屏上把开关挤进
 * 那一行还会让按钮组吃掉小半行。
 */
type PipelineOptionsProps = {
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
const LABEL_CLASS = "flex items-center gap-2 text-lg text-text-muted cursor-pointer";

export function PipelineOptions({
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
        <span title="首页读不出乐器时继续往后看几页，用来认出扉页起排的总谱。">分析总谱</span>
      </label>
      <label className={LABEL_CLASS}>
        <input
          type="checkbox"
          checked={autoSegment}
          onChange={(e) => onAutoSegmentChange(e.target.checked)}
          className="accent-primary"
        />
        <span title="勾上之后，这一批分析完会自动跑窄带 OCR，把各声部的位置找出来；不勾也能在页脚手点「识别分段」。">
          乐谱分段
        </span>
      </label>
    </div>
  );
}
