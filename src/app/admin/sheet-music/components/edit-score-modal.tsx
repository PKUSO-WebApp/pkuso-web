"use client";

/**
 * 改曲目信息（曲名 / 作曲家 / 备注）。
 *
 * 三个字段与「新增曲子」弹窗（`../page.tsx` 的 `createScore`）**逐字一致** ——
 * 它们是同一份数据、同一处入口，分两套写迟早会在「空串还是 null」这种细节上分叉
 * （落库那一半在 `../library-edit.ts` 的 `planScoreEdit`）。
 *
 * ⚠️ **条件渲染**（父组件用 `{editing && <EditScoreModal …/>}`）：初值直接写进 `useState`，
 * 靠**重新挂载**取新值。用 `open` 控制显隐 + `useEffect` 同步初值的话，
 * 弹窗关掉再打开会带上上一次的残留（本仓在 `upload-modal.tsx` 里踩过同类的坑，
 * 那边的解法是给表单发令牌）。
 */

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { planScoreEdit } from "../library-edit";
import { saveScoreEdit } from "../library-save";

type EditScoreModalProps = {
  onClose: () => void;
  scoreId: string;
  initial: { title: string; composer: string | null; notes: string | null };
  /** 保存成功。父组件据此重新拉数据 —— 由它决定怎么刷新，弹窗不碰列表状态 */
  onSaved: () => void;
};

export function EditScoreModal({ onClose, scoreId, initial, onSaved }: EditScoreModalProps) {
  const [title, setTitle] = useState(initial.title);
  // 库里可空的两列在输入框里一律显示成空串（`null` 进受控 input 会变成 "null"）
  const [composer, setComposer] = useState(initial.composer ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [error, setError] = useState("");
  // 防重复提交：ref 同步阻断竞态窗口，state 异步兜底。React setState 是异步的，
  // 两次快速点击之间 state 仍是旧值，只靠 state 挡不住（仓库既有写法见
  // `../page.tsx` 的 `createScore`）。
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const submit = async () => {
    if (savingRef.current || saving) return;
    const planned = planScoreEdit({ title, composer, notes });
    if (!planned.ok) {
      setError(planned.error);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveScoreEdit({ scoreId, plan: planned.plan });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /**
   * 保存中**任何路径都不许关**。
   *
   * ⚠️ 只给「取消」加 `disabled` 与只写 `closeOnOverlay={!saving}` 都**不够**：
   * `Modal` 标题栏那颗「关闭」按钮（`components/ui/Modal.tsx`）调的是同一个 `onClose`
   * 且**没有 disabled**，而它是键盘唯一够得着的关闭入口（遮罩那颗是 `tabIndex={-1}`）。
   * 它一关，弹窗就从树上摘掉了 —— 在飞的那笔请求回来时：成功则 `onSaved` 照样刷新
   * （用户以为自己取消了，改动却生效了），失败则 `setError` 落在一个已经卸载的组件上，
   * **屏幕上连一个字都没有**。
   *
   * 所以这里守的是**所有关闭路径的汇合点**，而不是逐颗按钮去加 disabled。
   * 保存成功后那一句仍走**原始的 `onClose`** —— 那时 `savingRef` 还是 true，
   * 走这个包装会把自己也关掉不了。
   */
  const requestClose = () => {
    if (savingRef.current || saving) return;
    onClose();
  };

  return (
    <Modal open onClose={requestClose} title="编辑曲目信息" closeOnOverlay={!saving}>
      <div className="space-y-4">
        <div>
          <label htmlFor="edit-score-title" className="block text-sm font-medium text-text mb-1">
            曲名 <span className="text-danger">*</span>
          </label>
          <input
            id="edit-score-title"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError("");
            }}
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="如：第五交响曲"
          />
        </div>

        <div>
          <label htmlFor="edit-score-composer" className="block text-sm font-medium text-text mb-1">
            作曲家
          </label>
          <input
            id="edit-score-composer"
            type="text"
            value={composer}
            onChange={(e) => {
              setComposer(e.target.value);
              setError("");
            }}
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="如：肖斯塔科维奇"
          />
        </div>

        <div>
          <label htmlFor="edit-score-notes" className="block text-sm font-medium text-text mb-1">
            备注
          </label>
          {/* 多行文本框保持可拖拽（不加 `resize-none`）—— 见 CLAUDE.md 的设计原则 */}
          <textarea
            id="edit-score-notes"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setError("");
            }}
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
            rows={3}
            placeholder="如：2024新年音乐会用"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      {/* 双按钮操作行靠右下角（Issue #182） */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-text-muted hover:text-text disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </Modal>
  );
}
