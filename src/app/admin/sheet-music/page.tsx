"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { UploadModal } from "./upload-modal";

interface SheetMusic {
  id: string;
  title: string;
  composer: string | null;
  notes: string | null;
  created_at: string;
  parts_count?: number;
}

export default function SheetMusicPage() {
  const router = useRouter();
  const [scores, setScores] = useState<SheetMusic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedScoreId, setSelectedScoreId] = useState<string | null>(null);
  const [newScore, setNewScore] = useState({ title: "", composer: "", notes: "" });

  const fetchScores = useCallback(async () => {
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
  }, []);

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

  const openUpload = (scoreId: string) => {
    setSelectedScoreId(scoreId);
    setShowUploadModal(true);
  };

  useEffect(() => {
    fetchScores();
  }, [fetchScores]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text">谱务管理</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
        >
          新增曲子
        </button>
      </div>

      <div className="grid gap-4">
        {scores.length === 0 ? (
          <div className="text-center py-12 text-text-muted">暂无曲子，点击「新增曲子」开始</div>
        ) : (
          scores.map((score) => (
            <div
              key={score.id}
              className="p-4 bg-card border border-border rounded-lg hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push(`/admin/sheet-music/${score.id}`)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-text">{score.title}</h3>
                  {score.composer && (
                    <p className="text-sm text-text-muted mt-1">{score.composer}</p>
                  )}
                  {score.notes && <p className="text-sm text-text-muted mt-1">{score.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openUpload(score.id);
                    }}
                    className="px-3 py-1 text-sm text-primary hover:bg-primary/10 rounded"
                  >
                    上传
                  </button>
                  <div className="text-sm text-text-muted">
                    {new Date(score.created_at).toLocaleDateString("zh-CN")}
                  </div>
                </div>
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
            fetchScores();
          }}
        />
      )}
    </div>
  );
}
