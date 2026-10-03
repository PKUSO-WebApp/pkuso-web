"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { canVisitAdminPath } from "@/lib/access";
import { removeSheetMusicObjects } from "./storage-cleanup";
import { useUser } from "@/context/user-context";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { Modal } from "@/components/ui/Modal";
import { UploadModal } from "./upload-modal";

/**
 * ⚠️ 可空性以 `src/types/database.types.ts` 为准（手写层与它对齐 —— 之前这里是 `string`，
 * 而生成类型说 `string | null`，于是泛型一接上就报错）。这一列在本文件里只当**列名**用
 *（`.order("created_at")`），没人消费它的值，所以对齐零连带。
 */
interface SheetMusic {
  id: string;
  title: string;
  composer: string | null;
  notes: string | null;
  created_at: string | null;
}

/**
 * `AdminHeader` 里 `handleBack` 的默认返回目标（本页不设 `onBack`，所以走的就是它）。
 * 拿它去问 `canVisitAdminPath`，就知道「这个角色的返回键是不是死按钮」。
 */
const BACK_TARGET = "/admin";

export default function SheetMusicPage() {
  const router = useRouter();
  const { user, signOut } = useUser();
  const { setTitle, setHeaderLeft, setHeaderRight } = useAdminPageHeader();
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

  const role = user?.role;

  // `signOut`（结束 Supabase 会话）而不是 `logout`（只清内存态）——
  // 后者会让「退出登录」变成装饰性的：守卫只看 `sessionUserId`，按后退就免密回来了。
  //
  // 用 `replace` 而不是 `push`：`push` 会把本页留在历史里，退出后按浏览器后退会回到
  // 这儿（此时已无会话，再被弹去 /login），用户看到的是「后退键按了没反应」。
  // `auth-gate.tsx` 守护页那个「退出登录」用的也是 replace。
  //
  // 不 await：signOut 失败也要把人送到登录页（失败由 context 里记日志）。
  const handleLogout = useCallback(() => {
    void signOut();
    router.replace("/login");
  }, [signOut, router]);

  // `setTitle` 会把 `hideBackButton` 重置为 false，而**那一步是必需的**：
  // `/admin` 首页有意置 true（为把右侧槽换成设置齿轮），本页要的是 false
  // （右侧槽给「新增」）。所以 `setTitle` 必须在最前，且之后别再动 `hideBackButton`。
  useEffect(() => {
    setTitle("谱务管理");

    // 判据走 `lib/access.ts`，**不内联角色比较**（那个文件头写着「判据必须收在一处」，
    // `AdminLayout` 里也写着别处照做）。这里的语义正是「默认的返回目标对这个角色越界吗」——
    // 内联 `role === "score_manager"` 的话，将来按那个文件的文档加第四个角色时，
    // 这个死按钮会**原样复活**，而且没有任何测试会红。
    if (!canVisitAdminPath(BACK_TARGET, role)) {
      // 本页没设 onBack，走 `AdminHeader` 里 `handleBack` 的默认分支（跳 BACK_TARGET）；
      // 而对这类角色 BACK_TARGET 越界 ⇒ 那个「返回」是按了被弹回原地的死按钮。
      // 用退出登录取代它 —— 这也基本是他唯一的出口（`/admin/profile` 对他同样越界）。
      // 曲子详情页的「返回」不动：那里的 setOnBack(router.back) 是有用的。
      //
      // ⚠️ **不要在这里调 `setHideBackButton(true)`。** 它名字像「隐藏返回键」，但
      // `AdminHeader` 里**右侧槽**的判据也是它（`hasTitle && !hideBackButton ? headerRight
      // : <设置齿轮>`）—— 置 true 会把「新增」换成设置齿轮，而齿轮指向 `/admin/profile`，
      // 对这类角色同样越界 ⇒ **等于拿一个死按钮换掉本页唯一的建谱入口**。
      // 左侧根本不需要它：`AdminHeader` 的左槽是 `headerLeft ? headerLeft : …`，已被抢占。
      setHeaderLeft(
        <button
          type="button"
          onClick={handleLogout}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-danger transition-colors hover:bg-muted"
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </button>,
      );
    } else {
      // 这个角色的「返回」指向 BACK_TARGET 且他不越界 ⇒ 对他有意义，保留原样，
      // 只清掉左侧槽（防止上一屏残留）。
      setHeaderLeft(null);
    }

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
    return () => {
      setHeaderRight(null);
      setHeaderLeft(null);
    };
  }, [role, handleLogout, setTitle, setHeaderLeft, setHeaderRight]);

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
      // 先**只查**（不改状态、不删附件）所有声部的 storage 路径：删行之后就查不到了
      const storagePaths: string[] = [];
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
          storagePaths.push(...files.map((f) => f.storage_path));
        }
      }

      // DB CASCADE 删除 parts + files：链 .select("id") 做 0 行检测 —— 0 行时无 error
      // （RLS 静默拒绝 / 已被并发删除），若按成功处理会先把 storage 删掉而库里那行还在。
      // 附件删除是副作用，必须排在检测之后（usePosts.remove 的同款顺序，Issue #368）
      const { data: deleted, error } = await supabase
        .from("sheet_music")
        .delete()
        .eq("id", score.id)
        .select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) throw new Error("没有匹配的记录，曲目可能已被删除");

      // 行删除成功后再清 storage（best-effort，失败不影响删除结果）；连带页图
      if (storagePaths.length > 0) {
        await removeSheetMusicObjects(storagePaths);
      }

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
                  aria-label={`删除 ${score.title}`}
                  title="删除曲目"
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
