"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { UploadModal } from "../upload-modal";

interface SheetMusicFile {
  id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  created_at: string;
}

interface SheetMusicPart {
  id: string;
  instrument: string;
  sort_order: number;
  files: SheetMusicFile[];
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
  const { setTitle, setOnBack, setHeaderRight } = useAdminPageHeader();
  const scoreId = params.id as string;

  const [score, setScore] = useState<SheetMusic | null>(null);
  const [parts, setParts] = useState<SheetMusicPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setTitle("曲子详情");
    setOnBack(router.back);
    setHeaderRight(
      <button
        onClick={() => setShowUploadModal(true)}
        className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90"
      >
        上传
      </button>,
    );
    return () => setHeaderRight(null);
  }, [setTitle, setOnBack, setHeaderRight, router]);

  useEffect(() => {
    (async () => {
      try {
        const { data: scoreData, error: scoreError } = await supabase
          .from("sheet_music")
          .select("*")
          .eq("id", scoreId)
          .single();

        if (scoreError) throw scoreError;
        setScore(scoreData);
        setTitle(scoreData.title);

        const { data: partsData, error: partsError } = await supabase
          .from("sheet_music_parts")
          .select("*")
          .eq("sheet_music_id", scoreId)
          .order("sort_order");

        if (partsError) throw partsError;

        const partsWithFiles: SheetMusicPart[] = [];
        for (const part of partsData || []) {
          const { data: filesData } = await supabase
            .from("sheet_music_files")
            .select("*")
            .eq("part_id", part.id)
            .order("created_at");

          partsWithFiles.push({ ...part, files: filesData || [] });
        }

        setParts(partsWithFiles);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreId]);

  const removeStorageFiles = async (paths: string[]) => {
    if (paths.length === 0) return;
    await supabase.storage.from("sheet-music").remove(paths);
  };

  const refetch = async () => {
    try {
      const { data: scoreData, error: scoreError } = await supabase
        .from("sheet_music")
        .select("*")
        .eq("id", scoreId)
        .single();

      if (scoreError) throw scoreError;
      setScore(scoreData);
      setTitle(scoreData.title);

      const { data: partsData, error: partsError } = await supabase
        .from("sheet_music_parts")
        .select("*")
        .eq("sheet_music_id", scoreId)
        .order("sort_order");

      if (partsError) throw partsError;

      const partsWithFiles: SheetMusicPart[] = [];
      for (const part of partsData || []) {
        const { data: filesData } = await supabase
          .from("sheet_music_files")
          .select("*")
          .eq("part_id", part.id)
          .order("created_at");

        partsWithFiles.push({ ...part, files: filesData || [] });
      }

      setParts(partsWithFiles);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  const deleteFile = async (file: SheetMusicFile) => {
    if (deletingId) return;
    if (!confirm(`确认删除文件「${file.file_name}」？`)) return;

    setDeletingId(file.id);
    try {
      await removeStorageFiles([file.storage_path]);
      const { error } = await supabase.from("sheet_music_files").delete().eq("id", file.id);
      if (error) throw error;
      await refetch();
    } catch (error) {
      console.error("Delete file error:", error);
      alert("删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const deletePart = async (part: SheetMusicPart) => {
    if (deletingId) return;
    const fileCount = part.files.length;
    if (!confirm(`确认删除声部「${part.instrument}」及其 ${fileCount} 个文件？`)) return;

    setDeletingId(part.id);
    try {
      const storagePaths = part.files.map((f) => f.storage_path);
      await removeStorageFiles(storagePaths);
      const { error } = await supabase.from("sheet_music_parts").delete().eq("id", part.id);
      if (error) throw error;
      await refetch();
    } catch (error) {
      console.error("Delete part error:", error);
      alert("删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const downloadFile = async (storagePath: string, fileName: string) => {
    const { data, error } = await supabase.storage.from("sheet-music").download(storagePath);

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
      </div>
    );
  }

  const totalFiles = parts.reduce((sum, p) => sum + p.files.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {score.composer && <p className="text-text-muted">{score.composer}</p>}
        {score.notes && <p className="text-sm text-text-muted">{score.notes}</p>}

        <div>
          <h2 className="text-sm font-medium text-text-muted mb-3">
            声部 ({parts.length}) · 文件 ({totalFiles})
          </h2>

          {parts.length === 0 ? (
            <div className="text-center py-12 text-text-muted border border-border rounded-lg">
              暂无声部，点击右上角「上传」添加
            </div>
          ) : (
            <div className="space-y-3">
              {parts.map((part) => (
                <div
                  key={part.id}
                  className="bg-card border border-border rounded-lg overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
                    <div>
                      <span className="font-medium text-text">{part.instrument}</span>
                      <span className="text-xs text-text-muted ml-2">
                        {part.files.length} 个文件
                      </span>
                    </div>
                    <button
                      onClick={() => deletePart(part)}
                      disabled={!!deletingId}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-danger hover:bg-danger/10 rounded disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      删除声部
                    </button>
                  </div>
                  {part.files.length > 0 && (
                    <div className="divide-y divide-border">
                      {part.files.map((file) => (
                        <div key={file.id} className="flex items-center justify-between px-4 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-text truncate">{file.file_name}</p>
                            {file.file_size != null && (
                              <p className="text-xs text-text-muted">
                                {(file.file_size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 ml-3 shrink-0">
                            <button
                              onClick={() => downloadFile(file.storage_path, file.file_name)}
                              className="px-3 py-1 text-sm text-primary hover:bg-primary/10 rounded"
                            >
                              下载
                            </button>
                            <button
                              onClick={() => deleteFile(file)}
                              disabled={!!deletingId}
                              className="p-1 text-text-muted hover:text-danger hover:bg-danger/10 rounded disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showUploadModal && (
        <UploadModal
          open={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          scoreId={scoreId}
          onUploaded={() => {
            refetch();
          }}
        />
      )}
    </div>
  );
}
