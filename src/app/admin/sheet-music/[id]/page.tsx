"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface SheetMusicFile {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  instrument_name: string | null;
  instrument_source: string | null;
  created_at: string;
}

interface SheetMusic {
  id: string;
  title: string;
  composer: string | null;
  notes: string | null;
  created_at: string;
}

export default function ScoreDetailPage() {
  const params = useParams();
  const router = useRouter();
  const scoreId = params.id as string;

  const [score, setScore] = useState<SheetMusic | null>(null);
  const [files, setFiles] = useState<SheetMusicFile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const { data: scoreData, error: scoreError } = await supabase
        .from("sheet_music")
        .select("*")
        .eq("id", scoreId)
        .single();

      if (scoreError) throw scoreError;
      setScore(scoreData);

      const { data: filesData, error: filesError } = await supabase
        .from("sheet_music_files")
        .select("*")
        .eq("sheet_music_id", scoreId)
        .order("created_at", { ascending: false });

      if (filesError) throw filesError;
      setFiles(filesData || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, [scoreId]);

  const downloadFile = async (filePath: string, fileName: string) => {
    const { data, error } = await supabase.storage.from("sheet-music-files").download(filePath);

    if (error) {
      console.error("Download error:", error);
      return;
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted">加载中...</div>
      </div>
    );
  }

  if (!score) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted">曲子不存在</p>
        <button
          onClick={() => router.push("/admin/sheet-music")}
          className="mt-4 text-primary hover:underline"
        >
          返回列表
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => router.push("/admin/sheet-music")}
          className="text-sm text-text-muted hover:text-text mb-2"
        >
          ← 返回列表
        </button>
        <h1 className="text-2xl font-bold text-text">{score.title}</h1>
        {score.composer && <p className="text-text-muted mt-1">{score.composer}</p>}
        {score.notes && <p className="text-sm text-text-muted mt-2">{score.notes}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text">声部文件 ({files.length})</h2>
        </div>

        {files.length === 0 ? (
          <div className="text-center py-12 text-text-muted border border-border rounded-lg">
            暂无文件，点击右上角上传
          </div>
        ) : (
          <div className="space-y-3">
            {files.map((file) => (
              <div key={file.id} className="p-4 bg-card border border-border rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text truncate">{file.file_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {file.instrument_name ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                          {file.instrument_name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-text-muted">
                          未识别
                        </span>
                      )}
                      {file.instrument_source && (
                        <span className="text-xs text-text-muted">
                          ({file.instrument_source === "llm" ? "AI 识别" : file.instrument_source})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      {(file.file_size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    onClick={() => downloadFile(file.file_path, file.file_name)}
                    className="ml-4 px-3 py-1 text-sm text-primary hover:bg-primary/10 rounded"
                  >
                    下载
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
