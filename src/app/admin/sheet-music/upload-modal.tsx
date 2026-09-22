"use client";

import { useState, useRef } from "react";
import JSZip from "jszip";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";

interface UploadFile {
  file: File;
  name: string;
  instrumentGuess?: string;
  status: "pending" | "uploading" | "analyzing" | "done" | "error";
  error?: string;
}

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  scoreId: string;
  onUploaded: () => void;
}

export function UploadModal({ open, onClose, scoreId, onUploaded }: UploadModalProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const newFiles: UploadFile[] = [];

    for (const file of selected) {
      if (file.type === "application/pdf") {
        newFiles.push({ file, name: file.name, status: "pending" });
      } else if (file.name.endsWith(".zip")) {
        // 解压 ZIP
        try {
          const zip = await JSZip.loadAsync(file);
          const pdfFiles = Object.keys(zip.files).filter((name) =>
            name.toLowerCase().endsWith(".pdf"),
          );

          for (const pdfName of pdfFiles) {
            const pdfData = await zip.files[pdfName].async("blob");
            const pdfFile = new File([pdfData], pdfName.split("/").pop() || pdfName, {
              type: "application/pdf",
            });
            newFiles.push({
              file: pdfFile,
              name: pdfName.split("/").pop() || pdfName,
              status: "pending",
            });
          }
        } catch {
          alert(`ZIP 文件解压失败: ${file.name}`);
        }
      }
    }

    setFiles((prev) => [...prev, ...newFiles]);
    // 清空 input 以允许重复选择相同文件
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const analyzeInstrument = async (file: File): Promise<string | undefined> => {
    // 取 PDF 第一页图片进行 OCR + LLM 分析
    try {
      // 简单方式：将整个 PDF 作为 base64 发送（Edge Function 会处理）
      const base64 = await fileToBase64(file);

      // 调用 OCR
      const { data: ocrData } = await supabase.functions.invoke("ocr-analyze", {
        body: { image_base64: base64, language: "eng" },
      });

      if (ocrData?.success && ocrData.text) {
        // 调用 LLM
        const { data: llmData } = await supabase.functions.invoke("llm-analyze", {
          body: { ocr_text: ocrData.text },
        });

        if (llmData?.success) {
          return llmData.instrument;
        }
      }
    } catch (err) {
      console.error("Analysis failed:", err);
    }
    return undefined;
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // 去掉 data:...;base64, 前缀
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const uploadAll = async () => {
    setIsUploading(true);

    try {
      // 获取当前用户
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        alert("请先登录");
        return;
      }

      for (let i = 0; i < files.length; i++) {
        const uploadFile = files[i];
        if (uploadFile.status === "done") continue;

        // 更新状态为上传中
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: "uploading" } : f)));

        // 上传 PDF 到 Storage
        const filePath = `${scoreId}/${uploadFile.file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("sheet-music-files")
          .upload(filePath, uploadFile.file, { contentType: "application/pdf", upsert: true });

        if (uploadError) {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "error", error: uploadError.message } : f,
            ),
          );
          continue;
        }

        // 分析声部
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: "analyzing" } : f)));

        const instrument = await analyzeInstrument(uploadFile.file);

        // 创建文件记录
        const { error: dbError } = await supabase.from("sheet_music_files").insert({
          sheet_music_id: scoreId,
          file_name: uploadFile.file.name,
          file_path: filePath,
          file_size: uploadFile.file.size,
          mime_type: "application/pdf",
          instrument_name: instrument || null,
          instrument_source: instrument ? "llm" : null,
          uploaded_by: user.id,
        });

        if (dbError) {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "error", error: dbError.message } : f,
            ),
          );
          continue;
        }

        // 更新状态为完成
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "done", instrumentGuess: instrument } : f,
          ),
        );
      }

      onUploaded();
    } finally {
      setIsUploading(false);
    }
  };

  const statusText = (status: UploadFile["status"]) => {
    switch (status) {
      case "pending":
        return "待上传";
      case "uploading":
        return "上传中...";
      case "analyzing":
        return "分析中...";
      case "done":
        return "完成";
      case "error":
        return "失败";
    }
  };

  const statusColor = (status: UploadFile["status"]) => {
    switch (status) {
      case "pending":
        return "text-text-muted";
      case "uploading":
        return "text-primary";
      case "analyzing":
        return "text-warning";
      case "done":
        return "text-success";
      case "error":
        return "text-danger";
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="上传乐谱文件">
      <div className="space-y-4">
        {/* 文件选择区域 */}
        <div
          className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.zip"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <p className="text-text-muted">点击选择文件</p>
          <p className="text-sm text-text-muted mt-1">支持 PDF 或 ZIP（自动解压）</p>
        </div>

        {/* 文件列表 */}
        {files.length > 0 && (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 bg-background border border-border rounded"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text truncate">{f.name}</p>
                  <p className={`text-xs ${statusColor(f.status)}`}>
                    {statusText(f.status)}
                    {f.instrumentGuess && ` → ${f.instrumentGuess}`}
                    {f.error && `: ${f.error}`}
                  </p>
                </div>
                {f.status === "pending" && (
                  <button
                    onClick={() => removeFile(i)}
                    className="ml-2 text-text-muted hover:text-danger"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text">
            取消
          </button>
          <button
            onClick={uploadAll}
            disabled={files.length === 0 || isUploading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {isUploading ? "上传中..." : `上传 ${files.length} 个文件`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
