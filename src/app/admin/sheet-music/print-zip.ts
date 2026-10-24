import JSZip from "jszip";
import { printFileName, uniquePrintName } from "./print-plan";

/**
 * 印制压缩包：每个「应印 > 0」的文件一份 PDF，名字改成 `{份数}份_{原文件名}.pdf`；
 * 可选附一份 `清单.txt`。
 *
 * 为什么在浏览器端打包：PDF 就在 Storage 里，管理端是桌面浏览器；不引入
 * 服务端临时文件/清理链路。PDF 本身已压缩，这里用 STORE（不再压一遍），
 * 快且不会把 CPU 花在没收益的地方。
 */

export interface PrintZipEntry {
  file_name: string;
  storage_path: string;
  copies: number;
}

export interface BuildPrintZipOptions {
  entries: PrintZipEntry[];
  /** 传了才附 清单.txt */
  manifest?: string;
  load: (storagePath: string) => Promise<ArrayBuffer>;
  onProgress?: (done: number, total: number) => void;
}

export async function buildPrintZip(opts: BuildPrintZipOptions): Promise<Blob> {
  const zip = new JSZip();
  const used = new Set<string>();
  const toPrint = opts.entries.filter((entry) => entry.copies > 0);

  for (let i = 0; i < toPrint.length; i += 1) {
    const entry = toPrint[i];
    const data = await opts.load(entry.storage_path);
    const name = uniquePrintName(printFileName(entry.copies, entry.file_name), used);
    zip.file(name, data, { compression: "STORE" });
    opts.onProgress?.(i + 1, toPrint.length);
  }

  if (opts.manifest) {
    // BOM：Windows 记事本/Excel 打开中文清单不乱码。
    // 用 fromCharCode 而不是在源码里放一个字面 BOM（不可见，编辑器/工具链容易弄丢）
    zip.file("清单.txt", String.fromCharCode(0xfeff) + opts.manifest, {
      compression: "STORE",
    });
  }

  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

export function printZipName(scoreTitle: string): string {
  const safe = scoreTitle.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim() || "乐谱";
  return `${safe}_印制.zip`;
}

/** 触发浏览器下载；blob URL 用完立刻 revoke（仓库既有约定） */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
