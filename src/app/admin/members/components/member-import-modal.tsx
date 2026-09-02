"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { FileSpreadsheet, CheckCircle, XCircle } from "lucide-react";

type MemberImportModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type ImportState = "idle" | "parsing" | "confirming" | "importing" | "success" | "error";

export function MemberImportModal({ open, onClose, onSuccess }: MemberImportModalProps) {
  const [state, setState] = React.useState<ImportState>("idle");
  const [excelFileName, setExcelFileName] = React.useState<string>("");
  const [parsedRows, setParsedRows] = React.useState<Record<string, unknown>[]>([]);
  const [columnHeaders, setColumnHeaders] = React.useState<string[]>([]);
  const [importResult, setImportResult] = React.useState<{
    success: boolean;
    message: string;
    details?: string[];
  } | null>(null);

  // 重置状态
  const resetState = () => {
    setState("idle");
    setExcelFileName("");
    setParsedRows([]);
    setColumnHeaders([]);
    setImportResult(null);
  };

  // 关闭弹窗时重置
  const handleClose = () => {
    resetState();
    onClose();
  };

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelFileName(file.name);
    setState("parsing");

    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // 转换为 JSON（第一行作为表头）
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const headers = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] || [];

      if (jsonData.length === 0) {
        setImportResult({
          success: false,
          message: "Excel 文件为空或格式不正确",
        });
        setState("error");
        return;
      }

      setParsedRows(jsonData);
      setColumnHeaders(headers.map(String));
      setState("confirming");
    } catch (err) {
      setImportResult({
        success: false,
        message: `解析 Excel 失败: ${err instanceof Error ? err.message : String(err)}`,
      });
      setState("error");
    }
  };

  // 确认导入
  const handleConfirmImport = async () => {
    setState("importing");

    try {
      const { supabase } = await import("@/lib/supabase");
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("未登录");
      }

      const response = await fetch("/api/admin/import-member-info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ rows: parsedRows }),
      });

      const result = await response.json();

      if (!response.ok) {
        setImportResult({
          success: false,
          message: result.error || "导入失败",
          details: result.details,
        });
        setState("error");
        return;
      }

      setImportResult({
        success: true,
        message: result.message || `成功导入 ${result.imported} 条数据`,
      });
      setState("success");
      onSuccess();
    } catch (err) {
      setImportResult({
        success: false,
        message: `导入失败: ${err instanceof Error ? err.message : String(err)}`,
      });
      setState("error");
    }
  };

  // 获取按钮文案
  const getButtonLabel = () => {
    switch (state) {
      case "parsing":
        return "解析中...";
      case "confirming":
        return `确认导入 ${parsedRows.length} 条数据`;
      case "importing":
        return "导入中...";
      default:
        return "选择文件";
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="导入团员信息">
      <div className="space-y-4">
        {/* 说明 */}
        <p className="text-xs text-text-muted">
          上传 Excel 文件，系统将根据配置的字段映射自动解析并导入团员信息。
          导入后会覆盖现有的团员信息数据。
        </p>

        {/* 文件上传区域 */}
        {state === "idle" || state === "parsing" ? (
          <label
            htmlFor="member-excel-upload"
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface p-6 text-sm text-text-muted hover:border-primary/50 hover:bg-muted"
          >
            <FileSpreadsheet className="h-8 w-8" />
            <span>{excelFileName || "点击选择 Excel 文件"}</span>
            <span className="text-xs">支持 .xlsx, .xls, .csv 格式</span>
          </label>
        ) : null}

        <input
          id="member-excel-upload"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileUpload}
          className="hidden"
          disabled={state !== "idle"}
        />

        {/* 数据预览 */}
        {state === "confirming" && parsedRows.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-muted">数据预览（前 5 行）：</p>
            <div className="max-h-40 overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    {columnHeaders.slice(0, 5).map((header, i) => (
                      <th key={i} className="px-2 py-1 text-left font-medium text-text-muted">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {columnHeaders.slice(0, 5).map((header, j) => (
                        <td key={j} className="px-2 py-1 text-text">
                          {String(row[header] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-text-muted">共 {parsedRows.length} 条数据</p>
          </div>
        )}

        {/* 导入结果 */}
        {importResult && (
          <div
            className={`rounded-xl p-3 ${
              importResult.success ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
            }`}
          >
            <div className="flex items-center gap-2">
              {importResult.success ? (
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 flex-shrink-0" />
              )}
              <span className="text-sm">{importResult.message}</span>
            </div>
            {importResult.details && importResult.details.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs">
                {importResult.details.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text hover:bg-muted"
          >
            {state === "success" || state === "error" ? "关闭" : "取消"}
          </button>
          {(state === "idle" || state === "confirming") && (
            <button
              type="button"
              onClick={state === "confirming" ? handleConfirmImport : undefined}
              disabled={state === "idle"}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {getButtonLabel()}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
