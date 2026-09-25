"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { UploadModal } from "../upload-modal";
import { sortPartsForDisplay } from "../sort-parts";

interface SheetMusicFile {
  id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  created_at: string;
  /** 中文乐器名。同一份谱子里不同乐器要按拼音排（见 sort-parts.ts） */
  instrument: string | null;
  /**
   * 分声部号。**恒非 NULL**（技术债 A2 的迁移 `20260926130000` 把残余 NULL 回填成空数组、
   * 并收了 NOT NULL），所以读取侧不再有 NULL 那一支 —— 「没有分声部」就是空数组。
   */
  sub_parts: number[];
}

interface SheetMusicPart {
  id: string;
  /** 声部名。旧的 `instrument` 列**已被迁移删掉**（技术债 A1，`20260926120000`），
   *  而 `section` 自那次迁移起是 `NOT NULL` —— 所以这里既不该读旧列、也不用兜空值。 */
  section: string;
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
          // ⚠️ 必须带 `id` 兜底：`sort_order` 实际全是 0，而 Postgres 对并列行
          // **不保证顺序**。展示顺序由 sortPartsForDisplay 决定，但「同档时谁在前」
          // 要靠这个基准序 —— 没有它，同一个页面刷新两次可能不一样。
          .order("sort_order")
          .order("id");

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

        // 展示顺序在这里算，不用查询里的 order —— `sort_order` 实际全是 0、
        // 文件的 `created_at` 是并发 worker 的完成顺序，两者都不表达业务顺序。
        // 查询里那两个 order 保留：它们给「恰好同档」的行一个确定的基准顺序。
        setParts(sortPartsForDisplay(partsWithFiles));
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
        // 同首屏那处：`sort_order` 全是 0，并列行要有确定性的兜底序
        .order("sort_order")
        .order("id");

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

      // 与首屏那条一样的排序 —— 两处必须同时改，改一处会让「刷新后顺序变了」
      setParts(sortPartsForDisplay(partsWithFiles));
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
    if (!confirm(`确认删除声部「${part.section}」及其 ${fileCount} 个文件？`)) return;

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
                      <span className="font-medium text-text">{part.section}</span>
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
