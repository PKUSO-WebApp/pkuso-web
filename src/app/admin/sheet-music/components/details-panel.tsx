"use client";

import type { UploadFile } from "../upload-modal.types";

/**
 * 行卡片展开后的**排查面板**：送检图像、裁切说明、弃权原因、warning、OCR 文本、LLM 结果。
 *
 * 这里全是「出问题时才要看」的东西，所以整块由 `./file-row` 用
 * `expanded && hasDetails(f)` 把关 —— 面板自己不做「该不该显示」的判断，
 * 拿到的 `f` 有什么就画什么（`f.preview` / `f.warning` 等各自为 undefined 时那一行不出现）。
 */
type DetailsPanelProps = {
  f: UploadFile;
};

export function DetailsPanel({ f }: DetailsPanelProps) {
  return (
    <div className="border-t border-border px-3 py-2 text-xs space-y-2 bg-muted/30">
      {f.preview && (
        <div>
          <span className="font-medium text-text-muted">
            送检图像{f.sourcePage ? `（第 ${f.sourcePage} 页）` : ""}：
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={f.preview}
            alt="送去 OCR 的图像"
            className="mt-1 w-40 border border-border rounded"
          />
        </div>
      )}
      {f.cropNote && <p className="text-text-muted">{f.cropNote}</p>}
      {/* 弃权原因：**排查用**，所以给的是后端那个 slug 而不是编一句人话 ——
          它要与后端日志对得上。用户能照做的那句话在状态行上（「需人工确认」）。
          ⚠️ 措辞必须是**过去式**、而且不能加「这一行未识别」之类的当下判断
          （对抗测试实测）：用户按提示手填之后这一行已经识别了，句子里那句
          「未识别原因」就成了假话；而**段级弃权**的行更特别 —— 它继承着源行的
          乐器名（状态行显示「已识别」），这时把原因藏起来恰恰会丢掉最需要它的
          那种情形。所以只陈述「上一次识别后端弃权了」这个**事实**。 */}
      {f.abstainReason && <p className="text-text-muted">上一次识别后端弃权：{f.abstainReason}</p>}
      {f.warning && <p className="text-warning">{f.warning}</p>}
      {f.ocrText && (
        <div>
          <span className="font-medium text-text-muted">OCR 文本：</span>
          <pre className="mt-1 p-2 bg-muted border border-border rounded text-text max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
            {f.ocrText}
          </pre>
        </div>
      )}
      {f.llmResult && (
        <div>
          <span className="font-medium text-text-muted">LLM 结果：</span>
          <p className="mt-1 text-text">{f.llmResult}</p>
        </div>
      )}
    </div>
  );
}
