"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { UploadModal } from "../upload-modal";
import { sortPartsForDisplay } from "../sort-parts";
import { EditScoreModal } from "../components/edit-score-modal";
import { EditFileModal } from "../components/edit-file-modal";

interface SheetMusicFile {
  id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  /** 可空性以 `src/types/database.types.ts` 为准（生成类型是 `string | null`）。 */
  created_at: string | null;
  /** 中文乐器名。同一份谱子里不同乐器要按拼音排（见 sort-parts.ts） */
  instrument: string | null;
  /**
   * 分声部号。**恒非 NULL**（迁移 `20260926130000` 把残余 NULL 回填成空数组、
   * 并收了 NOT NULL），所以读取侧不再有 NULL 那一支 —— 「没有分声部」就是空数组。
   */
  sub_parts: number[];
}

interface SheetMusicPart {
  id: string;
  /** 声部名。旧的 `instrument` 列**已被迁移删掉**（`20260926120000`），
   *  而 `section` 自那次迁移起是 `NOT NULL` —— 所以这里既不该读旧列、也不用兜空值。
   *  （形状的仓内事实来源是 `src/types/database.types.ts`。） */
  section: string;
  /** ⚠️ 生成类型是 `number | null` —— 与它对齐（#314）。全仓没人消费这个值
   *  （`sort-parts.ts` 只提过一句「实际全是 0」），所以对齐零连带。 */
  sort_order: number | null;
  files: SheetMusicFile[];
}

interface SheetMusic {
  id: string;
  title: string;
  composer: string | null;
  notes: string | null;
  /** 可空性以 `src/types/database.types.ts` 为准（生成类型是 `string | null`）。 */
  created_at: string | null;
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
  // 两个编辑弹窗都是**条件渲染**（见组件头部注释：初值靠重新挂载取，不靠 open 同步）
  const [showEditScore, setShowEditScore] = useState(false);
  const [editingFile, setEditingFile] = useState<{
    file: SheetMusicFile;
    part: SheetMusicPart;
  } | null>(null);

  useEffect(() => {
    setTitle("曲子详情");
    setOnBack(router.back);
    setHeaderRight(
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowEditScore(true)}
          className="px-3 py-1 text-sm text-text-muted border border-border rounded-lg hover:text-text"
        >
          编辑
        </button>
        <button
          onClick={() => setShowUploadModal(true)}
          className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90"
        >
          上传
        </button>
      </div>,
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
      // 先删库行、**再**删 storage：链 .select("id") 做 0 行检测 —— 0 行时无 error
      // （RLS 静默拒绝 / 行已被并发删除），若按成功处理会把附件先删掉而库里那行还在。
      // 附件删除是副作用，必须排在检测之后（usePosts.remove 的同款顺序，Issue #368）
      const { data: deleted, error } = await supabase
        .from("sheet_music_files")
        .delete()
        .eq("id", file.id)
        .select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) throw new Error("没有匹配的记录，文件可能已被删除");
      await removeStorageFiles([file.storage_path]);
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
      // 同 deleteFile：先删库行（带 0 行检测）再删 storage —— 0 行时不动附件（Issue #368）
      const storagePaths = part.files.map((f) => f.storage_path);
      const { data: deleted, error } = await supabase
        .from("sheet_music_parts")
        .delete()
        .eq("id", part.id)
        .select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) throw new Error("没有匹配的记录，声部可能已被删除");
      await removeStorageFiles(storagePaths);
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
                              onClick={() => setEditingFile({ file, part })}
                              className="p-1 text-text-muted hover:text-primary hover:bg-primary/10 rounded"
                              aria-label={`编辑 ${file.file_name}`}
                              title="编辑声部 / 乐器名 / 分声部"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteFile(file)}
                              disabled={!!deletingId}
                              aria-label={`删除 ${file.file_name}`}
                              title="删除文件"
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

      {/* 两个编辑弹窗。曲目信息的初值取 `score`，一份谱的初值取被点的那一行 ——
        两者都用条件渲染，关掉即卸载，下次打开拿到的是最新数据。 */}
      {showEditScore && score && (
        <EditScoreModal
          onClose={() => setShowEditScore(false)}
          scoreId={scoreId}
          initial={{ title: score.title, composer: score.composer, notes: score.notes }}
          onSaved={refetch}
        />
      )}

      {editingFile && (
        <EditFileModal
          onClose={() => setEditingFile(null)}
          scoreId={scoreId}
          file={editingFile.file}
          part={{ id: editingFile.part.id, section: editingFile.part.section }}
          sourceFileCount={editingFile.part.files.length}
          onSaved={refetch}
        />
      )}

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
