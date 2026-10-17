"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { boundaryCandidates, evidenceByPage, segmentIndexOfPage } from "../segmentation";
import { renderBandThumbs } from "../band-render";
import type { UploadFile, UploadPhase } from "../upload-modal.types";

/**
 * 分段块里的**核实面板**（pkuso-backend#96 §6 的人工侧）：模型据以判断的引文、被它丢掉的切点、
 * 每条边界那几页的窄带图与窄带文本。
 *
 * 它解决的那个具体问题：分段的结论只有一行「识别出 N 段 / 1 段」，而**「模型没找到边界」与
 * 「模型找到了但被后端丢掉」在这行字上一模一样** —— 两者的修法却相反（改 prompt vs 改校验），
 * 于是管理员此前只能重跑分段（再烧 N 次 OCR）来区分，而重跑不一定跑得更好。
 *
 * ## 四条纪律（改这个文件前先读）
 *
 * 1. **默认关着，关着 = 零成本**：不解析 PDF、不渲染图、不发请求。展开才按需出图。
 * 2. **不猜**：分不出来的事（老响应里没有 `rawCuts` / `candidates` 字段）就直说分不出来，
 *    **不许**显示成「模型弃权」或「没有候选」；没有引文就说没有，不拿别的字段凑一句像样的话。
 * 3. **挪边界走的是与输入框同一个入口**（`onSegmentStartRawChange` + `onCommitSegmentStart`）：
 *    不重跑 OCR —— 页文本与窄带图都已经在手里（#290 的验收标准之一）。
 *    ⚠️ 两次调用在**同一个 tick** 里发是安全的：`editSegments` 用的是函数式 `setFiles`，
 *    提交那一份读到的就是刚写进去的原文。这也正是用户在输入框里手打一遍走的路。
 * 4. **缩略图不进行状态**（见 `band-render.ts`）：缓存留在本组件的 ref 里、按 `f.file` 核对 ——
 *    行是按**下标** key 的，拆一行/还原一次之后同一个组件实例可能已经换了一份文件。
 */

type SegEvidenceProps = {
  /** 这一行 */
  f: UploadFile;
  /** 它在 `files` 里的下标（下面每个 handler 都要用它定位这一行） */
  i: number;
  /** 弹窗阶段 —— 禁用纪律与边界输入框**逐字一致**，别再想第二套 */
  phase: UploadPhase;
  segBusy: boolean;
  /** 段的起点数组。与上面那份编辑框同源（父组件传的 `startsOf(f)`），不许在这里重算 */
  starts: number[];
  onSegmentStartRawChange: (i: number, si: number, text: string) => void;
  onCommitSegmentStart: (i: number, si: number) => void;
  /** 删一条边界（「取消这条边界」）—— 与段块里的「合并」是同一个入口 */
  onMergeSegment: (i: number, si: number) => void;
  /** 在指定页插一条边界（「采用为边界」）—— 与段块里的「拆分」是同一个入口，`at` 指定页 */
  onSplitSegment: (i: number, si: number, at?: number) => void;
};

/** 窄带图片的显示宽度（px）。真实窄带约 6:1，所以它是个「一条」的形状 */
const THUMB_PX = 112;

/** 候选首页行里的动作按钮（「取消这条边界」/「采用为边界」共用一套样式） */
const CANDIDATE_BUTTON_CLASS =
  "px-2 py-0.5 text-xs border border-border rounded shrink-0 hover:text-primary disabled:opacity-50";

export function SegEvidence({
  f,
  i,
  phase,
  segBusy,
  starts,
  onSegmentStartRawChange,
  onCommitSegmentStart,
  onMergeSegment,
  onSplitSegment,
}: SegEvidenceProps) {
  const [open, setOpen] = useState(false);
  /** 页号 → data URL。`null` = 这一轮还没跑完（「渲染中」与「没渲染出来」是两件事） */
  const [thumbs, setThumbs] = useState<Map<number, string> | null>(null);
  const [thumbErr, setThumbErr] = useState<string | null>(null);
  /** 出图缓存。**按 `f.file` 核对**：行按下标 key，拆分/还原之后实例可能换了一份文件 */
  const cacheRef = useRef<{ file: File; urls: Map<number, string> } | null>(null);

  const diag = f.segDiagnostics;
  const evByPage = useMemo(() => evidenceByPage(diag?.cuts, diag?.evidence), [diag]);

  /**
   * 要出图的页 = 每条边界的**候选页**（当前页 ±1，被 `boundarySpan` 裁过）去重后的并集。
   * 边界之间会重叠（上一条的下一页就是下一条的当前页），所以去重是必须的。
   */
  const pagesKey = starts
    .flatMap((_, si) => boundaryCandidates(starts, si, f.pageCount ?? 1))
    .filter((p, k, all) => all.indexOf(p) === k)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (!open || !pagesKey) return;
    const pages = pagesKey.split(",").map(Number);
    // 缓存按文件核对：换了文件就当没有（否则会把上一次的图挂到这一行上）
    const cache =
      cacheRef.current?.file === f.file ? cacheRef.current : { file: f.file, urls: new Map() };
    cacheRef.current = cache;
    const missing = pages.filter((p) => !cache.urls.has(p));
    if (missing.length === 0) {
      setThumbs(new Map(cache.urls));
      return;
    }
    let cancelled = false;
    setThumbErr(null);
    renderBandThumbs(f.file, missing, { isCancelled: () => cancelled, maxWidth: THUMB_PX * 3 })
      .then((got) => {
        if (cancelled) return;
        got.forEach((url, p) => cache.urls.set(p, url));
        setThumbs(new Map(cache.urls));
      })
      .catch((err) => {
        // 整份打不开（坏 PDF / 资源缺失）：说一句，**同时把按钮从「渲染中…」推进到「没渲染出来」**
        // ——只 `setThumbErr` 的话 `thumbs` 还停在 `null`，每个候选页永远显示「渲染中…」，
        // 与旁边那句「没能渲染」互相打架（本仓栽过的「降级掩盖失败」）。
        if (cancelled) return;
        setThumbs(new Map(cache.urls));
        setThumbErr(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, f.file, pagesKey]);

  /** 把第 `si` 条边界挪到第 `p` 页（走输入框那条路，不重跑 OCR） */
  const move = (si: number, p: number) => {
    onSegmentStartRawChange(i, si, String(p));
    onCommitSegmentStart(i, si);
  };

  const locked = phase === "uploading" || segBusy;
  const textOf = (p: number) => f.pageTexts?.find((t) => t.page === p)?.text;

  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-0.5 text-xs border border-border rounded shrink-0 hover:text-primary"
      >
        {/* 「依据」与「页文本」都要写进按钮：只写「详情」的话没人知道里面能核实什么 */}
        {open ? "收起分段依据" : "分段依据与页文本"}
      </button>
      {open && (
        <div className="space-y-2 rounded border border-border bg-muted/30 px-2 py-1.5 text-xs">
          {/* ① 模型这一轮到底给了什么 —— 「为什么没切」的答案在这里 */}
          {!diag ? (
            <p className="text-text-muted">
              这次分段没留下诊断字段 —— 引文与「为什么没切」都看不到
            </p>
          ) : diag.rawCuts === undefined ? (
            <p className="text-text-muted">
              {/* 拼成一个字符串再渲染：JSX 的折行会被折成一个空格，
                  中文里就变成「字段）—— 「模型…」」这种多一个空格的排版（同 `segment-block`） */}
              {"这次响应里没有 rawCuts / rejected（后端还没回这两个字段）——" +
                "「模型没给切点」与「给了被丢掉」在这里分不开"}
            </p>
          ) : (
            <>
              <p className="text-text-muted">
                {diag.rawCuts.length === 0
                  ? // ⚠️ **不写「模型弃权」**：后端在「模型回了空 cuts」与「输出压根没解析成那个形状」
                    // （例如 `max_tokens` 截断成非法 JSON）上回的是**同一个**形状（`rawCuts: []`），
                    // 而这两件事的修法相反（补边界 vs 查截断/重跑）。替它下结论会把管理员推向错的方向。
                    "这次没拿到任何切点 —— 漏掉的边界只能人工补（「模型弃权」与「输出没解析出来」在后端是同一个形状，这里分不开）"
                  : `模型给了 ${diag.rawCuts.length} 个切点${
                      Array.isArray(diag.cuts) ? `，后端留下 ${diag.cuts.length} 个` : ""
                    }`}
              </p>
              {diag.rejected.length > 0 && (
                <div>
                  <p className="text-warning">{`被后端丢掉的切点 ${diag.rejected.length} 个：`}</p>
                  <ul className="text-warning">
                    {diag.rejected.map((r, k) => (
                      <li key={k}>
                        {/* 理由给的是**后端那个 slug**（与 `abstainReason` 同一条规矩）：
                            它要能与后端日志对上，别在这里编一句人话 */}
                        {`第 ${r.page ?? "?"} 页：${r.reason}`}
                        {r.evidence ? `（模型抄的引文「${r.evidence}」）` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {/* ④ 候选首页：模型给的全部候选 + 后端裁决（pkuso-backend#96 §6）。
              ⚠️ **缺失字段 ≠ 空数组**：前者是「后端还没升级」，后者是「回了、但没有候选」。
              未采纳的候选也要列出来 —— 模型漏切时这里是人工补边界的入口。
              低置信（后端 slug `low-confidence`）整行用警告色：它不是「模型没看见」，
              而是「看见了但没把握」，正是最该让人看一眼的那一类。 */}
          {diag && (
            <div className="border-t border-border pt-1.5 space-y-1">
              <p className="text-text-muted">候选首页（模型给的 + 后端裁决）：</p>
              {diag.candidates === undefined ? (
                <p className="text-text-muted">这次响应没有候选字段（后端还没升级）</p>
              ) : diag.candidates.length === 0 ? (
                <p className="text-text-muted">这次响应里没有候选首页</p>
              ) : (
                <ul className="space-y-1">
                  {diag.candidates.map((c, k) => {
                    // 后端 slug。**不**在前端重算「置信度 < 某阈值」：那是后端的判据，
                    // 抄一份阈值到界面上，后端一调这里就开始说假话。
                    const low = c.rejection === "low-confidence";
                    const page = c.page;
                    // 动作看**当前** `starts`，不看 `accepted` 的历史快照：用户可能已经
                    // 手动采用/取消过。`accepted` 只用于显示后端当时的裁决。
                    const boundaryAt = page === null ? -1 : starts.indexOf(page);
                    const segAt =
                      page !== null && page > 1 && boundaryAt < 0
                        ? segmentIndexOfPage(starts, page, f.pageCount ?? 1)
                        : -1;
                    const pageText = page === null ? "页码未给出" : `第 ${page} 页`;
                    const confText =
                      c.confidence === null
                        ? "置信度未给出"
                        : `置信度 ${Math.round(c.confidence * 100)}%`;
                    const statusText = c.accepted
                      ? "已采纳"
                      : c.rejection
                        ? `未采纳（${c.rejection}）`
                        : "未采纳";
                    return (
                      <li
                        key={k}
                        className={`border-t border-border pt-1 space-y-0.5 ${
                          low ? "text-warning" : "text-text"
                        }`}
                      >
                        <p>{`${pageText} · ${confText} · ${statusText}`}</p>
                        <p className="break-all">{`理由：${c.reason ?? "（模型没写理由）"}`}</p>
                        {boundaryAt >= 1 ? (
                          <button
                            onClick={() => onMergeSegment(i, boundaryAt)}
                            disabled={locked}
                            className={CANDIDATE_BUTTON_CLASS}
                            title="删掉这条边界，把这一段并进上一段"
                          >
                            取消这条边界
                          </button>
                        ) : page !== null && page > 1 && segAt >= 0 ? (
                          <button
                            onClick={() => onSplitSegment(i, segAt, page)}
                            disabled={locked}
                            className={CANDIDATE_BUTTON_CLASS}
                            title={`把第 ${page} 页采用为一条边界（不重跑 OCR）`}
                          >
                            采用为边界
                          </button>
                        ) : (
                          <p className="text-text-muted">
                            {page === 1
                              ? "第 1 页是第 1 段的定义，不是边界"
                              : "这一页无法作为边界（页码未给出或超出页数）"}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {thumbErr && <p className="text-danger">{`窄带图没能渲染：${thumbErr}`}</p>}

          {/* ② 每条边界：模型为它给的引文 + 那几页的窄带图（点图 = 把边界挪过去） */}
          {starts.slice(1).map((page, k) => {
            const si = k + 1;
            const ev = evByPage.get(page);
            return (
              <div key={si} className="border-t border-border pt-1.5 space-y-1">
                <p className="text-text-muted">{`第 ${si + 1} 段从第 ${page} 页起`}</p>
                <div className="flex flex-wrap gap-1.5">
                  {boundaryCandidates(starts, si, f.pageCount ?? 1).map((p) => {
                    const url = thumbs?.get(p);
                    const here = p === page;
                    return (
                      <button
                        key={p}
                        onClick={() => move(si, p)}
                        disabled={here || locked}
                        aria-label={
                          here ? `第 ${p} 页（当前边界）` : `把第 ${si + 1} 段的起点挪到第 ${p} 页`
                        }
                        title={here ? "现在的边界" : "挪到这里（不重跑 OCR）"}
                        className={`w-28 shrink-0 border rounded p-0.5 text-left ${
                          here ? "border-primary" : "border-border hover:border-primary"
                        } disabled:opacity-50`}
                      >
                        {url ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`第 ${p} 页首部窄带`}
                              className="w-full rounded border border-border"
                            />
                          </>
                        ) : (
                          // 「还没跑完」与「这一页没渲染出来」是两件事，不能都显示成转圈
                          <span className="block px-1 py-2 text-text-muted">
                            {thumbs === null ? "渲染中…" : "没渲染出来"}
                          </span>
                        )}
                        <span className="block px-1 pt-0.5 text-text-muted">
                          {here ? `第 ${p} 页（当前）` : `挪到第 ${p} 页`}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-text">
                  {ev
                    ? `模型引文：「${ev}」`
                    : "模型没有为这一页给出引文（这一条边界可能是你手动挪过来的）"}
                </p>
                <p className="text-text-muted break-all">
                  {`这一页的窄带文本：${textOf(page) ?? "（没取到，那一页 OCR 失败）"}`}
                </p>
              </div>
            );
          })}

          {/* ③ 每页窄带文本（零成本：已经在手上）—— 「为什么没在这一页切」多半能在这里看出来 */}
          {f.pageTexts?.length ? (
            <div className="border-t border-border pt-1.5">
              {/* 总数报 `pageCount` 而不是 `pageTexts.length`：**OCR 失败的页不在 `pageTexts` 里**，
                  拿它的长度当「全部」会在那些页上对读者说一句假话（「全部 3 页」而这份谱有 5 页） */}
              <p className="text-text-muted">
                {f.pageCount && f.pageCount > f.pageTexts.length
                  ? `已取到文本的 ${f.pageTexts.length} 页（共 ${f.pageCount} 页）：`
                  : `全部 ${f.pageTexts.length} 页的窄带文本：`}
              </p>
              <div className="mt-0.5 max-h-32 overflow-y-auto space-y-0.5">
                {[...f.pageTexts]
                  .sort((a, b) => a.page - b.page)
                  .map((t) => (
                    <p key={t.page} className="text-text break-all">
                      {`第 ${t.page} 页：${t.text || "（这一页一个字都没读到）"}`}
                    </p>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
