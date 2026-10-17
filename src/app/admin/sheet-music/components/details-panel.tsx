"use client";

import type { UploadFile } from "../upload-modal.types";
import { MAX_PAGES_EXAMINED } from "../analysis";
import { hasDetails } from "../row-text";

/**
 * 行卡片展开后的**排查面板**：送检图像、裁切说明、弃权原因、warning、OCR 文本、LLM 结果。
 *
 * 这里全是「出问题时才要看」的东西。**组件自己守 `hasDetails(f)`**：调用点
 * （`./file-row` 的 `expanded && hasDetails(f)`）也守着同一道门，但组件单独被复用时
 * 不该画出空面板 —— 判据只有一份（`row-text.ts` 的 `hasDetails`），两处都调它。
 */
type DetailsPanelProps = {
  f: UploadFile;
};

export function DetailsPanel({ f }: DetailsPanelProps) {
  if (!hasDetails(f)) return null;
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
          {/* 分析页游走上界（不含分段行：段级识别只读本段首页，不按页游走）。
              N 取自常量，别再抄一份字面量。 */}
          {!f.splitOf && f.pageCount && f.pageCount > MAX_PAGES_EXAMINED && (
            <p className="mt-1 text-text-muted">
              分析最多只看前 {MAX_PAGES_EXAMINED} 页（共 {f.pageCount} 页）
            </p>
          )}
        </div>
      )}
    </div>
  );
}
