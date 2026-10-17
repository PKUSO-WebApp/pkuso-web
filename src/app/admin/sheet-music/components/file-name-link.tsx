"use client";

import { useState } from "react";
import { statusColor, statusText } from "../row-text";
import type { UploadFile } from "../upload-modal.types";

/**
 * 上传弹窗里的文件名 —— 点它在新标签页打开**这一行对应的 PDF**。
 *
 * 只让**文件名**可点（不是整行）：行上还有展开/移除等动作，整行做成链接会互相抢点击。
 * 文件是用户刚选的本地 `File`，所以走 `URL.createObjectURL`（与详情页下载同一个原语），
 * 不碰 storage / RLS，也不发网络请求。失败必须有可见反馈：弹窗被浏览器拦下时
 * `window.open` 返回 `null`，这里把它落成一句红字，而不是静默什么都不发生。
 *
 * ⚠️ blob URL 不能立刻 revoke（新标签页会来不及加载），也不能不 revoke（泄漏）；
 * 60 秒后回收。打开失败的那条路径立刻回收。
 */
export function FileNameLink({ file, name }: { file: File; name: string }) {
  const [error, setError] = useState<string | null>(null);

  const openFile = () => {
    setError(null);
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      setError("无法读取这个文件");
      return;
    }
    try {
      // ⚠️ 不加 `noopener`：带它时 `window.open` 按规范**恒返回 null**，就分不清
      // 「被拦下」与「成功打开」。改为打开后立刻切断 opener。
      const win = window.open(url, "_blank");
      if (!win) {
        URL.revokeObjectURL(url);
        setError("浏览器拦截了新标签页，请允许弹窗后重试");
        return;
      }
      win.opener = null;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      URL.revokeObjectURL(url);
      setError("打开失败，请重试");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openFile}
        title={`在新标签页打开 ${name}`}
        className="block max-w-full truncate text-left text-sm text-text hover:text-primary hover:underline"
      >
        {name}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * 行首的「文件名 + 状态」两行（上传弹窗与分析列表里各有一份，原先逐字重复）。
 * 抽出来只为让两处共用同一个可点的文件名；状态文案仍走 `../row-text`，这里不新增判据。
 */
export function FileTitle({ f }: { f: UploadFile }) {
  return (
    <>
      <FileNameLink file={f.file} name={f.originalName} />
      <p className={`text-xs ${statusColor(f)}`}>{statusText(f)}</p>
    </>
  );
}
