"use client";

import { boundarySpan, parseBoundaryText } from "../segmentation";
import type { UploadFile, UploadPhase } from "../upload-modal.types";

/**
 * 行卡片里的**分段块**：状态行（未识别 / 识别中 / 失败 / 识别出 N 段）、失败页提示、
 * 逐段的边界编辑（合并 / 拆分）与「确认这 N 段」。
 *
 * ⚠️ **「什么时候出现」不在这里判**：父组件用 `segEligible(f)` 把关（与上传拦截同源）。
 *
 * ⚠️ **这些 helper 与禁用标志都是 props、不是在这里重算的**：本仓栽过「同一条判据
 * 有几份拷贝，只有一份有测试」的坑 —— `unsplitSegments` 尤其不能重写，它与上传拦截
 * **必须是同一个函数**（分两份写时，跑完分段再把声部改成总谱就会造出一个死胡同：
 * 分段块整块不渲染，而拦截还在，文案指着两个屏幕上不存在的按钮 —— 实测过这条路径）。
 */

type SegmentBlockProps = {
  /** 这一行 */
  f: UploadFile;
  /** 它在 `files` 里的下标 —— 下面每个 handler 都要用它定位这一行 */
  i: number;
  /** 弹窗阶段（`UploadPhase`，定义在 `upload-modal.types.ts`）—— 与父组件共用一份，别再抄字面量 */
  phase: UploadPhase;
  segBusy: boolean;
  hasAnalyzingFiles: boolean;
  /* ↓↓ 纯 helper（都是 `(f) => …`）：由父组件传进来，而不是在这里重写 —— */
  /** 这一行跑分段要几次 OCR（`segmentation.ts` 的 `estimateOcrCalls`） */
  costOf: (f: UploadFile) => number;
  /** 归一化后的段列表 */
  segmentsOf: (f: UploadFile) => { from: number; to: number }[];
  /** 段的起点数组（界面上编辑的那个） */
  startsOf: (f: UploadFile) => number[];
  /** 输入框原文数组（缺字段时按起点回填） */
  startTextOf: (f: UploadFile) => string[];
  /** **识别出多段、却还没拆** —— 显示条件与上传拦截同一份判据
   *（见 `../row-text.ts` 的 `unsplitSegments` 的 docblock；拦截点在 `upload-modal.tsx` 的 `confirmUpload`） */
  unsplitSegments: (f: UploadFile) => boolean;
  /* ↓↓ handler */
  onSegmentStartRawChange: (i: number, si: number, text: string) => void;
  onCommitSegmentStart: (i: number, si: number) => void;
  onMergeSegment: (i: number, si: number) => void;
  onSplitSegment: (i: number, si: number) => void;
  onSplitIntoSegments: (i: number) => void;
};

export function SegmentBlock({
  f,
  i,
  phase,
  segBusy,
  hasAnalyzingFiles,
  costOf,
  segmentsOf,
  startsOf,
  startTextOf,
  unsplitSegments,
  onSegmentStartRawChange,
  onCommitSegmentStart,
  onMergeSegment,
  onSplitSegment,
  onSplitIntoSegments,
}: SegmentBlockProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-text-muted">分段：</span>
        {f.segState === "running" && (
          <span className="text-xs text-text-muted">识别中…（约 {costOf(f)} 次 OCR）</span>
        )}
        {f.segState === "error" && <span className="text-xs text-danger">失败：{f.segError}</span>}
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
            const bad = span !== null && parseBoundaryText(raw, span.lo, span.hi) === null;
            return (
              <li key={si} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-text-muted shrink-0 w-14">第 {si + 1} 段</span>
                {si === 0 ? (
                  <span className="text-text-muted w-16 shrink-0">第 1 页起</span>
                ) : (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={raw}
                    onChange={(e) => onSegmentStartRawChange(i, si, e.target.value)}
                    onBlur={() => onCommitSegmentStart(i, si)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onCommitSegmentStart(i, si);
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
                    onClick={() => onMergeSegment(i, si)}
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
                  onClick={() => onSplitSegment(i, si)}
                  disabled={phase === "uploading" || segBusy || seg.to - seg.from < 1}
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
          onClick={() => onSplitIntoSegments(i)}
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
  );
}
