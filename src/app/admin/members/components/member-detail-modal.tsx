"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from "@/constants/instruments";
import { isValidPhoneNumber } from "@/lib/validation";
import type { ProfileRow } from "@/types/database";
import type { ProfileUpdatePayload } from "@/hooks/useProfiles";

/** 在团情况二选一（编辑表单用）：在团 → is_in_orchestra=true，不在团 → false */
const ORCHESTRA_STATUS_OPTIONS = ["在团", "不在团"] as const;

type AdminMemberDetailModalProps = {
  open: boolean;
  /** 当前编辑的成员，null 时不展示内容 */
  user: ProfileRow | null;
  onClose: () => void;
  /** 保存回调（由页面传入 useProfiles 的 update 方法），返回 true 表示保存成功 */
  onSave: (id: string, payload: ProfileUpdatePayload) => Promise<boolean>;
};

type FormState = {
  full_name: string;
  instrument: string;
  college: string;
  email: string;
  phone_number: string;
  join_date: string;
  is_section_leader: boolean;
  is_in_orchestra: boolean;
};

/** admin 侧成员详情弹窗：可编辑全部字段，保存走 supabase 直连（RLS admin UPDATE 策略） */
export function AdminMemberDetailModal({
  open,
  user,
  onClose,
  onSave,
}: AdminMemberDetailModalProps) {
  // 提交状态提升到弹窗层：提交中禁止关闭（遮罩 closeOnOverlay + 标题栏/取消按钮守卫），
  // 避免"以为取消、实际已保存"的误操作。
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false); // 同步 guard：handleClose 需同步读到提交状态

  const setSubmitting = (v: boolean) => {
    submittingRef.current = v;
    setIsSubmitting(v);
  };

  // 用户主动关闭（遮罩/标题栏关闭按钮）：提交中禁止
  const handleClose = () => {
    if (submittingRef.current) return;
    onClose();
  };

  // 表单状态放在子组件内并用 key=user.id 重置：Modal 关闭时子组件卸载，
  // 再次打开（或切换成员）时重新挂载，useState 初始值即取最新成员数据
  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="成员详情"
      position="bottom"
      closeOnOverlay={!isSubmitting}
    >
      {user && (
        <MemberEditForm
          key={user.id}
          user={user}
          onClose={handleClose}
          onSave={onSave}
          isSubmitting={isSubmitting}
          setSubmitting={setSubmitting}
        />
      )}
    </Modal>
  );
}

/** 成员编辑表单：独立子组件以便用 key 重置状态 */
function MemberEditForm({
  user,
  onClose,
  onSave,
  isSubmitting,
  setSubmitting,
}: {
  user: ProfileRow;
  onClose: () => void;
  onSave: (id: string, payload: ProfileUpdatePayload) => Promise<boolean>;
  isSubmitting: boolean;
  setSubmitting: (v: boolean) => void;
}) {
  const [form, setForm] = React.useState<FormState>(() => ({
    full_name: user.full_name ?? "",
    instrument: user.instrument ?? "",
    college: user.college ?? "",
    email: user.email ?? "",
    phone_number: user.phone_number ?? "",
    join_date: user.join_date ?? "",
    is_section_leader: user.is_section_leader,
    // 历史数据可能为 NULL（未设置）：表单为二元选择，默认按在团处理，保存时写入显式布尔
    is_in_orchestra: user.is_in_orchestra ?? true,
  }));
  const [formError, setFormError] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false); // 同步 guard，阻断竞态窗口

  // 乐器下拉选项：声部顺序 + 「其他」，若当前值不在列表中也加入，避免值丢失
  const instrumentOptions = React.useMemo(() => {
    const list = [...INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP];
    if (form.instrument && !list.includes(form.instrument)) return [...list, form.instrument];
    return list;
  }, [form.instrument]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    // 双重 guard 防重复提交：ref 同步阻断 + state 异步兜底
    if (submittingRef.current || isSubmitting) return;

    if (!form.full_name.trim()) {
      setFormError("姓名不能为空");
      return;
    }
    const phone = form.phone_number.trim();
    if (phone && !isValidPhoneNumber(phone)) {
      setFormError("手机号格式不正确（11 位数字，以 1 开头）");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const ok = await onSave(user.id, {
        full_name: form.full_name.trim(),
        instrument: form.instrument.trim() || null,
        college: form.college.trim() || null,
        email: form.email.trim() || null,
        phone_number: phone || null,
        join_date: form.join_date.trim() || null,
        is_section_leader: form.is_section_leader,
        is_in_orchestra: form.is_in_orchestra,
      });
      if (ok) {
        // 先解除提交状态（setSubmitting 同步更新 ref），再关闭，避免 handleClose 守卫拦截
        submittingRef.current = false;
        setSubmitting(false);
        onClose();
        return;
      }
      setFormError("保存失败，请重试");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-3">
      {user.is_section_leader && (
        <p className="rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning">🏅 声部长</p>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">姓名</label>
        <input
          type="text"
          value={form.full_name}
          onChange={(e) => setField("full_name", e.target.value)}
          className="input"
          placeholder="姓名"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">乐器</label>
        <select
          value={form.instrument}
          onChange={(e) => setField("instrument", e.target.value)}
          className="input"
        >
          {instrumentOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">学院</label>
        <input
          type="text"
          value={form.college}
          onChange={(e) => setField("college", e.target.value)}
          className="input"
          placeholder="学院"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">邮箱</label>
        <input
          type="text"
          value={form.email}
          onChange={(e) => setField("email", e.target.value)}
          className="input"
          placeholder="邮箱"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">联系方式</label>
        <input
          type="text"
          value={form.phone_number}
          onChange={(e) => setField("phone_number", e.target.value)}
          className="input"
          placeholder="11 位手机号"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">入团时间</label>
        <input
          type="text"
          value={form.join_date}
          onChange={(e) => setField("join_date", e.target.value)}
          className="input"
          placeholder="如：2026秋"
        />
      </div>
      {/* 在团情况（入团时间下方，二元 Toggle）：在团 → 团员 / 不在团 → 团友 */}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">在团情况</label>
        <Toggle
          options={ORCHESTRA_STATUS_OPTIONS}
          value={form.is_in_orchestra ? "在团" : "不在团"}
          onChange={(v) => setField("is_in_orchestra", v === "在团")}
        />
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={form.is_section_leader}
          onChange={(e) => setField("is_section_leader", e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <span className="text-sm text-text">声部长</span>
      </label>

      {formError && <p className="text-xs text-danger">{formError}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={onClose}
          className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}
