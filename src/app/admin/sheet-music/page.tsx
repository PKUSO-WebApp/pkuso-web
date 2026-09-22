"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { Modal } from "@/components/ui/Modal";
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
  // 防重复提交：ref 同步阻断竞态窗口，state 异步兜底。React setState 是异步的，
  // 两次快速点击之间 state 仍是旧值，只靠 state 挡不住（仓库既有写法见
  // admin/rehearsals/new/page.tsx）。
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // 「新增曲子」表单的会话令牌：每次打开/关闭都自增。
  // 提交是异步的，若用户在提交途中关掉（或关掉后重开）表单，那笔陈旧回调回来时
  // 不该再动当前表单 —— 否则会把用户刚敲进去的内容清空，还替他弹出上传弹窗。
  const formTokenRef = useRef(0);

  useEffect(() => {
    setTitle("谱务管理");
    setHeaderRight(
      <button
        onClick={() => {
          // 打开即新开一次表单会话：令牌自增让途中的陈旧提交失效，同时清掉上次残留的输入
          // 与提交态（否则新表单会被那笔在飞请求连坐锁住）
          formTokenRef.current += 1;
          submittingRef.current = false;
          setIsSubmitting(false);
          setNewScore({ title: "", composer: "", notes: "" });
          setShowCreateModal(true);
        }}
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

  const closeCreateModal = () => {
    formTokenRef.current += 1;
    // 用户放弃了这次表单：立刻解掉提交态，否则重开的新表单会被那笔在飞请求连坐锁住。
    // 在飞请求的 finally 有令牌守卫，不会反过来清掉新表单的提交态。
    submittingRef.current = false;
    setIsSubmitting(false);
    setShowCreateModal(false);
  };

  const createScore = async () => {
    // 双重检查：ref 同步阻断，state 异步兜底
    if (submittingRef.current || isSubmitting) return;
    if (!newScore.title.trim()) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    // 记下这次提交属于哪一次表单会话
    const token = formTokenRef.current;
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

      // 曲目确实建好了，无论表单后来怎样都要进列表；用函数式更新避免闭包里的旧快照
      setScores((prev) => [data, ...prev]);

      // 表单已经不是这一份了（用户关掉或重开了）：只入列表，别动当前表单和弹窗
      if (formTokenRef.current !== token) return;

      setShowCreateModal(false);
      setNewScore({ title: "", composer: "", notes: "" });
      setSelectedScoreId(data.id);
      setShowUploadModal(true);
    } catch (error) {
      console.error("Error creating score:", error);
      // 用户已放弃这次表单就不要再弹窗打扰
      if (formTokenRef.current === token) alert("创建失败");
    } finally {
      // 只清掉属于自己这次会话的提交态；用户关掉/重开表单后不要动后来者的
      if (formTokenRef.current === token) {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
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

      <Modal
        open={showCreateModal}
        onClose={closeCreateModal}
        title="新增曲子"
        // 提交途中不允许点遮罩关掉：关掉后那笔陈旧提交回来会替用户弹出上传弹窗，
        // 并清空他重开表单后刚敲进去的内容（仓库既有写法见 create-schedule-modal.tsx）
        closeOnOverlay={!isSubmitting}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              曲名 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={newScore.title}
              onChange={(e) => setNewScore({ ...newScore, title: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="如：第五交响曲"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">作曲家</label>
            <input
              type="text"
              value={newScore.composer}
              onChange={(e) => setNewScore({ ...newScore, composer: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="如：肖斯塔科维奇"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">备注</label>
            <textarea
              value={newScore.notes}
              onChange={(e) => setNewScore({ ...newScore, notes: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="如：2024新年音乐会用"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={closeCreateModal}
            disabled={isSubmitting}
            className="px-4 py-2 text-text-muted hover:text-text disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={createScore}
            disabled={isSubmitting || !newScore.title.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </Modal>

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
