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

  useLayoutEffect(() => {
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
