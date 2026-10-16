"use client";

import { useLayoutEffect, useRef } from "react";
import type { UploadFile, UploadPhase } from "./upload-modal.types";
import { autoSegmentPlan, type SegAutoTarget } from "./auto-segment";

type UseAutoSegmentParams = {
  /** 「乐谱分段」开关。勾选态在选文件阶段就定死 —— 分析开始后那个开关块不再渲染 */
  enabled: boolean;
  phase: UploadPhase;
  /** 行**现取**：判据要读的是提交那一刻的行，不是某次渲染的快照（父组件的 `filesRef`） */
  filesRef: { readonly current: readonly UploadFile[] };
  hasAnalyzingFiles: boolean;
  segBusy: boolean;
  refiningCount: number;
  /** 点火动作 —— 传进来的就是手点那个 `startSegmentation`，不走第二条路 */
  run: (targets: readonly SegAutoTarget[]) => void;
};

/**
 * 「分析收尾后自动点火」（#386）。
 *
 * ⚠️ **这一层只管「什么时候评估」**，判据一行都不在这里 —— 全在 `auto-segment.ts`（纯的、可单测）。
 *
 * 为什么是 `useLayoutEffect` 而不是 `useEffect`：与 `filesRef` 那条理由同源。被动 effect 是
 * 调度器 normal 优先级的任务，用户正在打字时输入事件能插到它前面 —— 于是「分析刚好收尾」
 * 那一拍，effect 里读到的可能是**编辑前**的行（比如用户刚把这一行标成总谱 = 别拆）。
 * layout effect 在提交那一刻同步跑完，读到的一定是已提交的那份状态。
 */
export function useAutoSegment({
  enabled,
  phase,
  filesRef,
  hasAnalyzingFiles,
  segBusy,
  refiningCount,
  run,
}: UseAutoSegmentParams): void {
  /**
   * ⚠️ `run` **不能进依赖数组**：父组件传的是每次渲染都新建的闭包，进依赖等于
   * 「每次渲染都评估一遍」，而这里要的恰恰是「只在收尾那几拍评估」。
   * 走 ref 存最新那份，effect 的依赖只留触发点。
   */
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });

  /**
   * 上一次评估时的 `phase`。
   *
   * ⚠️ `phase` 在这里**既当闸门又当触发点**，而它有一条**反向**转场：上传尝试收尾
   * （传成功、传失败、或未登录被 `alert` 挡回）时，`confirmUpload` 的 `finally` 会把
   * `uploading` 落回 `confirm`。那不是「分析收尾」—— 用户此刻在干的是上传。
   *
   * 不管它的后果是可复现的：分析收尾时不合格的行（模型判**总谱**，或弃权被用户填上声部之前），
   * 用户后来**手改声部**把它改合格 —— 此后随便哪一次 `phase` 落回 `confirm` 都会点火：
   * 在「分析早就跑完」很久之后凭空空烧 N×页窄带 OCR，还把那一行静默拆段。
   * 所以这条转场只当闸门、不当触发点。
   */
  const prevPhaseRef = useRef(phase);

  useLayoutEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    // ⚠️ 别把这里改成「只在 `analyzing → confirm` 时才评估」：**逐行重试**那条路根本不动
    // `phase`（`retryRow` 只改行的状态，弹窗一直停在 confirm），它靠 `hasAnalyzingFiles`
    // 落回假来触发 —— 那样写会把「重试完的那一行自动进分段」一起掐掉。
    if (prevPhase === "uploading" && phase === "confirm") return;

    const plan = autoSegmentPlan({
      enabled,
      phase,
      files: filesRef.current,
      hasAnalyzingFiles,
      segBusy,
      refiningCount,
    });
    if (plan.fire) runRef.current(plan.targets);
    // ⚠️ 依赖里**故意没有 `files`**：有它的话，用户在输入框里敲一个字就会评估一次
    //（行本身从 `filesRef` 现取，所以评估时拿到的仍是最新行）。触发点是这几个量：
    // 分析收尾（`phase` / `hasAnalyzingFiles`）、分段收尾（`segBusy`）、
    // 段级识别收尾（`refiningCount`）、以及开关本身。逐行重试之后那一行分析完、
    // `hasAnalyzingFiles` 落回假 —— 同样落在这些触发点里。
    //
    // ⚠️ 重入**不靠这里的依赖数组兜**：点火动作自己（`startSegmentation`）有同步的
    // `segRunningRef` 闸，与手点共用。所以同一提交里被评估两次（StrictMode 双调用，
    // 或两个触发点同时翻转）也只起一个池子；分段跑完前 `segBusy` 还是真，第二拍进不来。
  }, [enabled, phase, filesRef, hasAnalyzingFiles, segBusy, refiningCount]);
}
