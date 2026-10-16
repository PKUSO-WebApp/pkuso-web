"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { UploadFile, UploadPhase } from "./upload-modal.types";
import { autoUploadBatch, readAutoUploadPref, writeAutoUploadPref } from "./auto-upload";

/**
 * 「分析完直接上传」（#386）的**接线层**：开关值 + 偏好持久化 + 点火。
 *
 * 判据一个字都不在这里（全在 `auto-upload.ts`，纯函数、有单测）；这个文件只有两件
 * 属于 React 的事：**什么时候评估**、**怎么把最新那一份 `confirmUpload` 取到手**。
 * 抽出来是因为 `upload-modal.tsx` 是行数棘轮顶上的 god file（只许变短），
 * 而这段接线本身是完整一件事，看得清也审得动。
 */

/**
 * 开关的值 + 持久化（本地偏好，与 `pkuso-theme` 同一套写法）。
 *
 * 初值恒为 `false`，**挂载后**再读存储：SSR 渲不出 `localStorage`，渲染期读会让
 * 首屏与 hydration 不一致（同一套理由见 `src/hooks/useTheme.ts`）。默认关是硬要求，
 * 所以「读到之前」画成未勾选正是对的 —— 不存在「先以为开着、再改回去」的窗口。
 */
export function useAutoUploadPref(): [boolean, (on: boolean) => void] {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    // 这条 setState 就在 effect 里、且是必须的：存储只有客户端读得到，而渲染期读会让
    // 首屏与 hydration 不一致（禁用理由与 `src/hooks/useTheme.ts` 同一条）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(readAutoUploadPref());
  }, []);
  // 先改 state 再落盘：写盘失败（隐私模式）不该影响这次点击 ——
  // `writeAutoUploadPref` 自己吞异常，只是不持久化
  const change = (on: boolean) => {
    setEnabled(on);
    writeAutoUploadPref(on);
  };
  return [enabled, change];
}

/**
 * 点火：把纯判据挂到弹窗的**收尾汇合点**上。
 *
 * ## 依赖数组里为什么没有 `files`
 * 加上它，用户每敲一个字都会重新评估一次，而那一拍行上正是半截乐器名 ——
 * 传出去就是用户文件系统里的文件名，**不可逆**。所以行状态从 `filesRef` 现取，
 * 评估只在下面这几个量变化时发生：分析收尾、分段收尾、段级识别收尾、开关翻动。
 *
 * ## `confirmUpload` 为什么走 ref
 * 它每次渲染都是新引用，进依赖等于每次都评估（回到上面那条）。所以是 latest-ref
 * 的写法：**无依赖数组的 layout effect**，每次提交后同步刷新。
 * 写成 `[confirmUpload]` 语义一样，但会被 exhaustive-deps 判成「依赖不稳定、
 * 请包 useCallback」—— 而包 useCallback 得把它闭包里的十几个值全列出来，得不偿失。
 *
 * ## 为什么不会传两次
 * `uploadingRef`（在 `confirmUpload` 自己开头）是同步闸；判据又要求行处于
 * `status === "analyzed"`，所以已 `done` / 正在 `uploading` 的行不会被再挑一次。
 * 跑完时 `setPhase("confirm")` 会让本 effect 再评估一次，那时结果是 `nothing-ready`。
 *
 * ## 关窗 / 取消之后
 * 弹窗一关，这个组件连同本 hook 一起被卸载，不会再有新的点火；已经在飞的那几个由
 * `confirmUpload` 里既有的 `cancelledRef` 检查收手 —— 与手点那条路逐字相同。
 */
export function useAutoUploadTrigger({
  enabled,
  segmentEnabled,
  confirmUpload,
  filesRef,
  phase,
  hasAnalyzingFiles,
  segBusy,
  refiningCount,
}: {
  /** 「分析完直接上传」的值（来自 `useAutoUploadPref`） */
  enabled: boolean;
  /** 「乐谱分段」总开关的值：开着而某几份还没跑分段时整批不点火（理由见 `autoUploadBatch`） */
  segmentEnabled: boolean;
  /** 最新一份 `confirmUpload` —— 与手点「确认上传」是同一个函数，没有第二条上传路径 */
  confirmUpload: () => Promise<void>;
  /** `files` 的最新值（行状态现取，见上面「依赖数组里为什么没有 files」） */
  filesRef: RefObject<UploadFile[]>;
  phase: UploadPhase;
  hasAnalyzingFiles: boolean;
  segBusy: boolean;
  refiningCount: number;
}) {
  const latest = useRef(confirmUpload);
  useLayoutEffect(() => {
    latest.current = confirmUpload;
  });

  useEffect(() => {
    const { fire } = autoUploadBatch(filesRef.current, {
      enabled,
      segmentEnabled,
      phase,
      hasAnalyzingFiles,
      segBusy,
      refiningCount,
    });
    if (!fire) return;
    // 不 await：点火即返回，进度由 phase / 行状态驱动渲染（与手点那条路一样）
    void latest.current();
    // `filesRef` 是 useRef 的稳定对象（父组件传下来的同一个），进不进依赖都不会多跑一次；
    // 列在这里只是为了不必再挂一条 disable。真正决定「什么时候评估」的是后面那六个量。
  }, [enabled, segmentEnabled, filesRef, phase, hasAnalyzingFiles, segBusy, refiningCount]);
}
