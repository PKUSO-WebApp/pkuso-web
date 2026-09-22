"use client";

import { useState, useRef } from "react";
import JSZip from "jszip";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";

interface UploadFile {
  file: File;
  name: string;
  status: "pending" | "analyzing" | "analyzed" | "uploading" | "done" | "error";
  error?: string;
  instrumentGuess?: string;
  instrumentEdit?: string;
  subPartGuess?: number | null;
  subPartEdit?: number | null;
  ocrText?: string;
  llmResult?: string;
}

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  scoreId: string;
  onUploaded: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateFileName(instrument: string, subPart: number | null): string {
  const base = instrument.trim().replace(/\s+/g, "");
  if (subPart !== null && subPart > 0) {
    return `${base}${subPart}.pdf`;
  }
  return `${base}.pdf`;
}

export function UploadModal({ open, onClose, scoreId, onUploaded }: UploadModalProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [phase, setPhase] = useState<"select" | "analyzing" | "confirm" | "uploading">("select");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const newFiles: UploadFile[] = [];

    for (const file of selected) {
      if (file.type === "application/pdf") {
        newFiles.push({ file, name: file.name, status: "pending" });
      } else if (file.name.endsWith(".zip")) {
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateFile = (index: number, patch: Partial<UploadFile>) => {
    setFiles((prev) => prev.map((f, idx) => (idx === index ? { ...f, ...patch } : f)));
  };

  const analyzeInstrument = async (
    file: File,
    index: number,
  ): Promise<{ instrument: string; subPart: number | null } | undefined> => {
    try {
      const base64 = await fileToBase64(file);

      let ocrText = "";
      try {
        const { data } = await supabase.functions.invoke("ocr-analyze", {
          body: {
            file_base64: base64,
            mime_type: file.type || "application/pdf",
          },
        });
        console.log("[OCR] response:", data);
        if (data?.success && data.text) {
          ocrText = data.text;
          updateFile(index, { ocrText, llmResult: "等待 LLM 分析..." });
        } else {
          console.log("[OCR] failed:", data);
          updateFile(index, {
            ocrText: data?.text || "(未识别到文字)",
            llmResult: `OCR 失败: ${data?.error || "未返回文字"}`,
          });
          return undefined;
        }
      } catch (err: unknown) {
        const detail =
          err && typeof err === "object" && "context" in err
            ? (err as { context: { error?: string } }).context?.error
            : undefined;
        updateFile(index, {
          ocrText: `OCR 请求失败: ${detail || (err instanceof Error ? err.message : String(err))}`,
        });
        return undefined;
      }

      try {
        const { data } = await supabase.functions.invoke("llm-analyze", {
          body: { ocr_text: ocrText, filename: file.name },
        });
        if (data?.success) {
          const instrument = String(data.instrument);
          const subPart = data.subPart ?? null;
          const display = subPart !== null ? `${instrument} ${subPart}` : instrument;
          updateFile(index, {
            llmResult: `识别结果: ${display}`,
            instrumentGuess: instrument,
            instrumentEdit: instrument,
            subPartGuess: subPart,
            subPartEdit: subPart,
          });
          return { instrument, subPart };
        } else {
          const errMsg = data?.error || data?.message || "未知错误";
          updateFile(index, { llmResult: `LLM 分析失败: ${errMsg}` });
          return undefined;
        }
      } catch (err: unknown) {
        const detail =
          err && typeof err === "object" && "context" in err
            ? (err as { context: { error?: string } }).context?.error
            : undefined;
        updateFile(index, {
          llmResult: `LLM 请求失败: ${detail || (err instanceof Error ? err.message : String(err))}`,
        });
        return undefined;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateFile(index, { ocrText: `分析异常: ${msg}` });
      return undefined;
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const startAnalysis = async () => {
    setPhase("analyzing");

    for (let i = 0; i < files.length; i++) {
      if (files[i].status === "pending") {
        updateFile(i, { status: "analyzing", ocrText: "正在 OCR...", llmResult: "" });
        const result = await analyzeInstrument(files[i].file, i);
        if (result) {
          updateFile(i, { status: "analyzed" });
        } else {
          updateFile(i, { status: "error", error: "声部识别失败" });
        }
        // 避免 Gemini 免费额度限流
        if (i < files.length - 1) {
          await sleep(800);
        }
      }
    }

    const allProcessed = files.every((f) => f.status === "analyzed" || f.status === "error");
    if (allProcessed) {
      setPhase("confirm");
    }
  };

  const getOrCreatePart = async (instrument: string): Promise<string | null> => {
    const { data: existing } = await supabase
      .from("sheet_music_parts")
      .select("id")
      .eq("sheet_music_id", scoreId)
      .eq("instrument", instrument)
      .maybeSingle();

    if (existing) return existing.id;

    const { data: newPart, error } = await supabase
      .from("sheet_music_parts")
      .insert({ sheet_music_id: scoreId, instrument })
      .select("id")
      .single();

    if (error) {
      console.error("Create part failed:", error);
      return null;
    }
    return newPart.id;
  };

  const handleInstrumentChange = (index: number, value: string) => {
    updateFile(index, { instrumentEdit: value });
  };

  const handleSubPartChange = (index: number, value: string) => {
    const num = value === "" ? null : parseInt(value, 10);
    updateFile(index, { subPartEdit: isNaN(num as number) ? null : num });
  };

  const confirmUpload = async () => {
    setPhase("uploading");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      alert("请先登录");
      setPhase("confirm");
      return;
    }

    let hasSuccess = false;

    for (let i = 0; i < files.length; i++) {
      const uploadFile = files[i];
      if (uploadFile.status === "done" || uploadFile.status === "error") continue;

      const instrument = uploadFile.instrumentEdit || uploadFile.instrumentGuess;
      const subPart = uploadFile.subPartEdit ?? uploadFile.subPartGuess ?? null;

      if (!instrument) {
        updateFile(i, { status: "error", error: "未指定声部" });
        continue;
      }

      updateFile(i, { status: "uploading" });

      const partId = await getOrCreatePart(instrument);
      if (!partId) {
        updateFile(i, { status: "error", error: "创建声部失败" });
        continue;
      }

      const generatedFileName = generateFileName(instrument, subPart);
      const filePath = `${scoreId}/${instrument}/${generatedFileName}`;
      const { error: uploadError } = await supabase.storage
        .from("sheet-music")
        .upload(filePath, uploadFile.file, { contentType: "application/pdf", upsert: true });

      if (uploadError) {
        updateFile(i, { status: "error", error: uploadError.message });
        continue;
      }

      const { error: dbError } = await supabase.from("sheet_music_files").insert({
        part_id: partId,
        storage_path: filePath,
        file_name: generatedFileName,
        file_size: uploadFile.file.size,
        uploaded_by: user.id,
      });

      if (dbError) {
        updateFile(i, { status: "error", error: dbError.message });
        continue;
      }

      updateFile(i, { status: "done", instrumentGuess: instrument });
      hasSuccess = true;
    }

    if (hasSuccess) onUploaded();
    setPhase("confirm");
  };

  const statusText = (f: UploadFile) => {
    switch (f.status) {
      case "pending":
        return "待分析";
      case "analyzing":
        return "分析中...";
      case "analyzed": {
        const inst = f.instrumentGuess || "";
        const sub =
          f.subPartGuess !== null && f.subPartGuess !== undefined ? ` ${f.subPartGuess}` : "";
        return inst ? `已识别 → ${inst}${sub}` : "识别失败";
      }
      case "uploading":
        return "上传中...";
      case "done": {
        const inst = f.instrumentGuess || "";
        const sub =
          f.subPartGuess !== null && f.subPartGuess !== undefined ? ` ${f.subPartGuess}` : "";
        return inst ? `已上传 → ${inst}${sub}` : "已上传";
      }
      case "error":
        return `失败: ${f.error}`;
    }
  };

  const statusColor = (status: UploadFile["status"]) => {
    switch (status) {
      case "pending":
        return "text-text-muted";
      case "analyzing":
        return "text-primary";
      case "analyzed":
        return "text-success";
      case "uploading":
        return "text-primary";
      case "done":
        return "text-success";
      case "error":
        return "text-danger";
    }
  };

  const hasDetails = (f: UploadFile) => f.ocrText || f.llmResult;

  const hasAnalyzedFiles = files.some((f) => f.status === "analyzed");

  return (
    <Modal open={open} onClose={onClose} title="上传乐谱文件">
      <div className="space-y-4">
        {phase === "select" && (
          <>
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

            {files.length > 0 && (
              <>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {files.map((f, i) => (
                    <div
                      key={i}
                      className="bg-background border border-border rounded-lg px-3 py-2 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text truncate">{f.name}</p>
                          <p className={`text-xs ${statusColor(f.status)}`}>{statusText(f)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="p-1 text-text-muted hover:text-danger"
                        title="移除"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text">
                    取消
                  </button>
                  <button
                    onClick={startAnalysis}
                    disabled={files.length === 0}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    开始分析 ({files.length} 个文件)
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {phase === "analyzing" && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {files.map((f, i) => (
              <div
                key={i}
                className="bg-background border border-border rounded-lg overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {hasDetails(f) ? (
                      <button
                        onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                        className="shrink-0 text-text-muted hover:text-text"
                      >
                        {expandedIdx === i ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text truncate">{f.name}</p>
                      <p className={`text-xs ${statusColor(f.status)}`}>{statusText(f)}</p>
                    </div>
                  </div>
                  {f.status === "analyzing" && (
                    <span className="animate-spin text-primary">⏳</span>
                  )}
                </div>
                {expandedIdx === i && hasDetails(f) && (
                  <div className="border-t border-border px-3 py-2 text-xs space-y-2 bg-muted/30">
                    {f.ocrText && (
                      <div>
                        <span className="font-medium text-text-muted">OCR 文本：</span>
                        <pre className="mt-1 p-2 bg-background border border-border rounded text-text max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
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
                )}
              </div>
            ))}
          </div>
        )}

        {(phase === "confirm" || phase === "uploading") && (
          <>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="bg-background border border-border rounded-lg overflow-hidden"
                >
                  <div className="flex items-start justify-between px-3 py-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {hasDetails(f) ? (
                        <button
                          onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                          className="shrink-0 text-text-muted hover:text-text"
                        >
                          {expandedIdx === i ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text truncate">{f.name}</p>
                        <p className={`text-xs ${statusColor(f.status)}`}>{statusText(f)}</p>
                      </div>
                    </div>
                    {f.status === "analyzed" && (
                      <div className="flex items-center gap-2 ml-3 flex-wrap">
                        <input
                          type="text"
                          value={f.instrumentEdit || ""}
                          onChange={(e) => handleInstrumentChange(i, e.target.value)}
                          placeholder="乐器名"
                          className="px-2 py-1 text-sm bg-background border border-border rounded w-40"
                        />
                        <input
                          type="number"
                          value={
                            f.subPartEdit !== null && f.subPartEdit !== undefined
                              ? String(f.subPartEdit)
                              : ""
                          }
                          onChange={(e) => handleSubPartChange(i, e.target.value)}
                          placeholder="分声部号"
                          min="1"
                          className="px-2 py-1 text-sm bg-background border border-border rounded w-24"
                        />
                        <span className="text-xs text-text-muted px-2">
                          文件名:{" "}
                          {generateFileName(
                            f.instrumentEdit || f.instrumentGuess || "",
                            f.subPartEdit ?? f.subPartGuess ?? null,
                          )}
                        </span>
                        <button
                          onClick={() =>
                            updateFile(i, {
                              instrumentEdit: f.instrumentGuess || "",
                              subPartEdit: f.subPartGuess,
                            })
                          }
                          className="p-1 text-text-muted hover:text-primary"
                          title="重置为识别结果"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {expandedIdx === i && hasDetails(f) && (
                    <div className="border-t border-border px-3 py-2 text-xs space-y-2 bg-muted/30">
                      {f.ocrText && (
                        <div>
                          <span className="font-medium text-text-muted">OCR 文本：</span>
                          <pre className="mt-1 p-2 bg-background border border-border rounded text-text max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
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
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text">
                取消
              </button>
              {phase === "confirm" && (
                <button
                  onClick={confirmUpload}
                  disabled={!hasAnalyzedFiles}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  确认上传 ({files.filter((f) => f.status === "analyzed").length} 个文件)
                </button>
              )}
              {phase === "uploading" && (
                <button
                  disabled
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg opacity-50"
                >
                  上传中...
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
