"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { UploadModal } from "./upload-modal";

interface SheetMusic {
  id: string;
  title: string;
  composer: string | null;
  notes: string | null;
  created_at: string;
}

export default function SheetMusicPage() {
  const router = useRouter();
  const { setTitle, setHeaderRight } = useAdminPageHeader();
  const [scores, setScores] = useState<SheetMusic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedScoreId, setSelectedScoreId] = useState<string | null>(null);
  const [newScore, setNewScore] = useState({ title: "", composer: "", notes: "" });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setTitle("谱务管理");
    setHeaderRight(
      <button
        onClick={() => setShowCreateModal(true)}
        className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90"
      >
        新增
      </button>,
    );
    return () => setHeaderRight(null);
  }, [setTitle, setHeaderRight]);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("sheet_music")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        setScores(data || []);
      } catch (error) {
        console.error("Error fetching scores:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const refetch = async () => {
    try {
      const { data, error } = await supabase
        .from("sheet_music")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setScores(data || []);
    } catch (error) {
      console.error("Error fetching scores:", error);
    }
  };

  const createScore = async () => {
    if (!newScore.title.trim()) return;

    try {
      const { data, error } = await supabase
        .from("sheet_music")
        .insert({
          title: newScore.title.trim(),
          composer: newScore.composer.trim() || null,
          notes: newScore.notes.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      setScores([data, ...scores]);
      setShowCreateModal(false);
      setNewScore({ title: "", composer: "", notes: "" });

      setSelectedScoreId(data.id);
      setShowUploadModal(true);
    } catch (error) {
      console.error("Error creating score:", error);
      alert("创建失败");
    }
  };

  const deleteScore = async (score: SheetMusic) => {
    if (deletingId) return;
    if (!confirm(`确认删除曲目「${score.title}」？`)) return;

    setDeletingId(score.id);
    try {
      // 查所有声部的文件，删 storage
      const { data: parts } = await supabase
        .from("sheet_music_parts")
        .select("id")
        .eq("sheet_music_id", score.id);

      if (parts && parts.length > 0) {
        const { data: files } = await supabase
          .from("sheet_music_files")
          .select("storage_path")
          .in(
            "part_id",
            parts.map((p) => p.id),
          );

        if (files && files.length > 0) {
          await supabase.storage.from("sheet-music").remove(files.map((f) => f.storage_path));
        }
      }

      // DB CASCADE 删除 parts + files
      const { error } = await supabase.from("sheet_music").delete().eq("id", score.id);
      if (error) throw error;
      setScores((prev) => prev.filter((s) => s.id !== score.id));
    } catch (error) {
      console.error("Delete score error:", error);
      alert("删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {scores.length === 0 ? (
          <div className="text-center py-12 text-text-muted">暂无曲子，点击右上角「新增」开始</div>
        ) : (
          scores.map((score) => (
            <div
              key={score.id}
              className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push(`/admin/sheet-music/${score.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-text">{score.title}</h3>
                  {score.composer && (
                    <p className="text-sm text-text-muted mt-1">{score.composer}</p>
                  )}
                  {score.notes && <p className="text-sm text-text-muted mt-1">{score.notes}</p>}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteScore(score);
                  }}
                  disabled={!!deletingId}
                  className="ml-3 p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded shrink-0 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold text-text mb-4">新增曲子</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  曲名 <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={newScore.title}
                  onChange={(e) => setNewScore({ ...newScore, title: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="如：第五交响曲"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-1">作曲家</label>
                <input
                  type="text"
                  value={newScore.composer}
                  onChange={(e) => setNewScore({ ...newScore, composer: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="如：肖斯塔科维奇"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-1">备注</label>
                <textarea
                  value={newScore.notes}
                  onChange={(e) => setNewScore({ ...newScore, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={3}
                  placeholder="如：2024新年音乐会用"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-text-muted hover:text-text"
              >
                取消
              </button>
              <button
                onClick={createScore}
                disabled={!newScore.title.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedScoreId && (
        <UploadModal
          open={showUploadModal}
          onClose={() => {
            setShowUploadModal(false);
            setSelectedScoreId(null);
          }}
          scoreId={selectedScoreId}
          onUploaded={() => {
            refetch();
          }}
        />
      )}
    </div>
  );
}
