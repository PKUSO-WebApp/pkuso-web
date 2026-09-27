"use client";

/**
 * 改**一份谱**（声部 / 乐器名 / 分声部号）—— 上传弹窗那一行编辑器的「事后版」。
 *
 * 三格控件的语义与 `./file-row.tsx` **逐条对齐**（那不是巧合，是要求）：
 *
 * - 声部是**闭集**，所以用 select；库里存的值若不在闭集内仍要显示出来（词表漂移看得见、也改得掉）
 * - 选「总谱」时把乐器名预填成「总谱」、分声部清空**且禁用**（总谱没有「第几号」可言）
 * - 分声部输入框存的是**原文**（`subPartsText`），不是解析结果 —— 受控输入直接存派生值的话，
 *   打字过程中的中间态会被当成完整值，`1,2` 永远敲不出来（见 `../sub-parts.ts` 的说明）
 *
 * 判据与写库都不在这里：`../library-edit.ts` 出「改成什么样或为什么不行」，
 * `../library-save.ts` 出「按什么顺序写、失败了怎么说」。本文件只负责渲染与取值。
 *
 * ⚠️ **条件渲染**（父组件用 `{editing && <EditFileModal …/>}`），理由同 `./edit-score-modal.tsx`。
 */

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from "@/constants/instruments";
import { isKnownSection } from "../row-text";
import { formatSubParts } from "../sub-parts";
import { planFileEdit } from "../library-edit";
import { saveFileEdit } from "../library-save";

type EditFileModalProps = {
  onClose: () => void;
  scoreId: string;
  file: {
    id: string;
    file_name: string;
    instrument: string | null;
    sub_parts: number[];
  };
  /** 这一行现在挂在哪个声部 —— 挪动与否由 `section` 与它的比较决定（见 `../library-save.ts`） */
  part: { id: string; section: string };
  /** 源声部下还有几份谱。等于 1 且真的挪走时，源声部会被一并收掉（那句话要给用户看） */
  sourceFileCount: number;
  onSaved: () => void;
};

export function EditFileModal({
  onClose,
  scoreId,
  file,
  part,
  sourceFileCount,
  onSaved,
}: EditFileModalProps) {
  const [section, setSection] = useState(part.section);
  const [instrument, setInstrument] = useState(file.instrument ?? "");
  const [subPartsText, setSubPartsText] = useState(formatSubParts(file.sub_parts));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const isFullScore = section === FULL_SCORE_SECTION;
  // 实时预览**走同一条判据**（`planFileEdit` 是纯函数、开销可忽略）：预览里显示的文件名
  // 就是保存后落库的那一个。别在这里另抄一遍 `generateFileName` 的推导 —— 三处各抄一份
  // 推导式的跟头这个子系统已经栽过一次。
  // 非法时**不显示红字**（那是提交后的事）：用户敲 `1,` 的中途就会非法一次，
  // 边打字边报错等于把正常输入过程说成错误。
  const preview = planFileEdit({ section, instrument, subPartsText });
  const moving = section !== part.section;

  const submit = async () => {
    if (savingRef.current || saving) return;
    const planned = planFileEdit({ section, instrument, subPartsText });
    if (!planned.ok) {
      setError(planned.error);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveFileEdit({
        scoreId,
        fileId: file.id,
        currentPartId: part.id,
        currentSection: part.section,
        plan: planned.plan,
      });
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
    <Modal open onClose={requestClose} title="编辑这份谱" closeOnOverlay={!saving}>
      <div className="space-y-4">
        <p className="text-xs text-text-muted">
          当前：{file.file_name}
          {file.instrument && file.instrument !== file.file_name && `（乐器名 ${file.instrument}）`}
        </p>

        <div>
          <label htmlFor="edit-file-section" className="block text-sm font-medium text-text mb-1">
            声部
          </label>
          <select
            id="edit-file-section"
            value={section}
            onChange={(e) => {
              const next = e.target.value;
              setSection(next);
              setError("");
              // 与 `./file-row.tsx` 的 `handleSectionChange` 同一条：选总谱 = 「整份都在里面」，
              // 乐器名与号都跟着定下来。切回别的声部时**不动**它们 —— 用户自己会改，
              // 而自动还原会把他刚敲的东西吃掉。
              if (next === FULL_SCORE_SECTION) {
                setInstrument(FULL_SCORE_SECTION);
                setSubPartsText("");
              }
            }}
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {/* 库里既有的非标准值也要能显示（否则一打开弹窗就会被悄悄改成列表里的第一项） */}
            {!isKnownSection(section) && <option value={section}>{section}（非标准）</option>}
            {INSTRUMENT_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={OTHER_INSTRUMENT_GROUP}>{OTHER_INSTRUMENT_GROUP}</option>
            <option value={FULL_SCORE_SECTION}>{FULL_SCORE_SECTION}</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="edit-file-instrument"
            className="block text-sm font-medium text-text mb-1"
          >
            乐器名
          </label>
          <input
            id="edit-file-instrument"
            type="text"
            value={instrument}
            onChange={(e) => {
              setInstrument(e.target.value);
              setError("");
            }}
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="如：F调圆号"
          />
        </div>

        <div>
          <label htmlFor="edit-file-subparts" className="block text-sm font-medium text-text mb-1">
            分声部号
          </label>
          <input
            id="edit-file-subparts"
            type="text"
            value={isFullScore ? FULL_SCORE_SECTION : subPartsText}
            onChange={(e) => {
              setSubPartsText(e.target.value);
              setError("");
            }}
            disabled={isFullScore}
            title={isFullScore ? "总谱是整份，没有分声部号" : "分声部号，如 1,2"}
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            placeholder="号，如 1,2"
          />
        </div>

        {moving && (
          <p className="text-xs text-text-muted">
            保存后这一份会挪到「{section}」
            {/* 源声部**不会**被自动收掉（理由见 `../library-save.ts` 顶部那段：删它是两次往返，
                而外键是 CASCADE —— 中间落进来的文件会被连带删掉）。它会留成一个空声部，
                所以这句话得说出来，并给出去处，否则用户读起来像「挪不干净」。 */}
            {sourceFileCount === 1 &&
              `；原声部「${part.section}」下已没有别的谱，它会空着（可在详情页用「删除声部」收掉）`}
          </p>
        )}

        {preview.ok ? (
          <p className="text-xs text-text-muted">
            保存后：{preview.plan.section} / {preview.plan.fileName}
          </p>
        ) : (
          // 非法时**只说「还不能保存」**，不显示具体原因 —— 原因留给提交后那句话，
          // 免得用户敲到一半就被判错。但也不能不吭声：那句预览会凭空消失。
          <p className="text-xs text-text-muted">保存后：（请先补全乐器名与分声部号）</p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

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
