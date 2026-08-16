"use client";

import React from "react";
import { Toggle } from "@/components/ui/Toggle";
import { Modal } from "@/components/ui/Modal";
import { useLeaveAdmin } from "@/hooks/useLeaveAdmin";
import { LeaveDetailModal } from "./leave-detail-modal";
import { formatRehearsalRange } from "@/lib/date-utils";
import type { LeaveRequestWithDetails } from "@/types/database";

/**
 * 管理端「请假审批」区块（Issue #142），位于入团审批区块下方。
 * - Toggle 切换 待审批 / 已处理；
 * - 二级筛选 Toggle「全部/请假/补请假」（Issue #156）：与 待审批/已处理 正交，
 *   不新增 DB 字段，按关联排练是否已结束分类（未结束=请假，已结束=补请假），
 *   切换任一方筛选都会清空勾选，避免批量操作误伤隐藏行；
 * - 待审批 tab：checkbox 勾选 + 全选，批量操作栏「批量通过」（二次确认）/
 *   「批量驳回」（原因必填弹窗，同一原因应用到全部勾选）；
 * - 点击列表项打开详情弹窗（审批/驳回/附件查看）。
 * 审批成功后本地移除已处理行，成员端重新进入页面可见同步结果。
 */

const STATUS_LABEL: Record<string, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  withdrawn: "已撤回",
  canceled: "已取消",
};

const STATUS_CHIP: Record<string, string> = {
  pending: "bg-warning-bg text-warning",
  approved: "bg-success-bg text-success",
  rejected: "bg-danger-bg text-danger",
  withdrawn: "bg-muted text-text-subtle",
  canceled: "bg-muted text-text-subtle",
};

/** 排练展示名：repertoire 优先（成员端卡片同源），缺失回退 title */
function rehearsalName(r: LeaveRequestWithDetails["rehearsals"]): string {
  return r?.repertoire ?? r?.title ?? "排练";
}

/** 请假分类标签（Issue #156）：按关联排练是否已结束判断，不新增 DB 字段 */
const CATEGORY_LABEL = { leave: "请假", retro: "补请假" } as const;
const CATEGORY_CHIP = {
  leave: "bg-muted text-text-muted",
  retro: "bg-warning-bg text-warning",
} as const;
type LeaveCategory = keyof typeof CATEGORY_LABEL;

/**
 * 排练是否已结束：end_time 优先；缺失时按 start_time+3h 兜底（排练通常 2-3 小时）；
 * 两者都缺失（或解析失败）视为未结束。now 与存储的本地时间比较（无时区字符串按本地解析）。
 */
function isRehearsalEnded(r: LeaveRequestWithDetails["rehearsals"], now = Date.now()): boolean {
  if (!r) return false;
  const end = r.end_time
    ? Date.parse(r.end_time)
    : r.start_time
      ? Date.parse(r.start_time) + 3 * 60 * 60 * 1000
      : Number.NaN;
  if (Number.isNaN(end)) return false;
  return now > end;
}

/** 申请分类：关联排练已结束 → 补请假；否则 → 请假 */
function getLeaveCategory(r: LeaveRequestWithDetails): LeaveCategory {
  return isRehearsalEnded(r.rehearsals) ? "retro" : "leave";
}

type LeaveManagementProps = {
  /** 待审批数量变化回调（admin 控制台 tab 红点计数用，Issue #150） */
  onPendingCountChange?: (count: number) => void;
};

export function LeaveManagement({ onPendingCountChange }: LeaveManagementProps = {}) {
  const {
    requests,
    loading,
    error,
    processing,
    fetch: fetchAll,
    approve,
    reject,
    getSignedUrl,
  } = useLeaveAdmin();
  const [tab, setTab] = React.useState<"pending" | "processed">("pending");
  // 分类二级筛选（Issue #156）：全部/请假/补请假，与 待审批/已处理 正交
  const [categoryFilter, setCategoryFilter] = React.useState<LeaveCategory | "all">("all");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  // 批量操作弹窗
  const [confirmApproveOpen, setConfirmApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const [rejectError, setRejectError] = React.useState<string | null>(null);
  const [batchBusy, setBatchBusy] = React.useState(false);
  const batchBusyRef = React.useRef(false);

  const pendingList = requests.filter((r) => r.status === "pending");
  const processedList = requests.filter((r) => r.status !== "pending");
  const tabList = tab === "pending" ? pendingList : processedList;
  // 分类筛选只作用于当前 status tab 内部（全部/请假/补请假）
  const list =
    categoryFilter === "all"
      ? tabList
      : tabList.filter((r) => getLeaveCategory(r) === categoryFilter);
  const detailRequest = requests.find((r) => r.id === detailId) ?? null;

  // 待审批数实时上报给父组件（控制台 tab 红点，Issue #150）；
  // 审批/驳回成功本地移除后 pendingList 变化会自动再次触发
  React.useEffect(() => {
    onPendingCountChange?.(pendingList.length);
  }, [pendingList.length, onPendingCountChange]);

  // 全选仅作用于当前分类筛选后可见的行（与「全选（n/m）」计数一致）
  const allSelected = list.length > 0 && list.every((r) => selectedIds.includes(r.id));

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : list.map((r) => r.id));
  };

  const handleBatchApprove = async () => {
    if (batchBusyRef.current || selectedIds.length === 0) return;
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const result = await approve(selectedIds);
      if (result.ok) {
        // 有 warnings（如成员已实际签到、考勤未联动）时逐条提示管理员（Issue #159 返工）
        if (result.warnings.length > 0) {
          alert(result.warnings.join("\n"));
        }
        setConfirmApproveOpen(false);
        setSelectedIds([]);
      } else {
        alert("批量通过失败");
      }
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  };

  const handleBatchReject = async () => {
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectError("请填写驳回原因");
      return;
    }
    if (batchBusyRef.current || selectedIds.length === 0) return;
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const ok = await reject(selectedIds, trimmed);
      if (ok) {
        setRejectOpen(false);
        setRejectReason("");
        setRejectError(null);
        setSelectedIds([]);
      } else {
        alert("批量驳回失败");
      }
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  };

  const busy = processing || batchBusy;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">请假审批</h2>
        <div className="flex items-center gap-1">
          <Toggle
            options={["pending", "processed"] as const}
            value={tab}
            onChange={(v) => {
              setTab(v);
              setSelectedIds([]);
            }}
            getLabel={(k) => (k === "pending" ? `待审批(${pendingList.length})` : "已处理")}
          />
          <button
            type="button"
            onClick={() => void fetchAll()}
            disabled={loading || busy}
            className="rounded-full px-2 py-1 text-label text-text-muted hover:bg-border disabled:opacity-60"
          >
            刷新
          </button>
        </div>
      </div>

      {/* 二级筛选：请假/补请假分类（与上方 待审批/已处理 正交，Issue #156）。
          切换筛选清空勾选，避免批量操作误伤被筛选隐藏的行 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <Toggle
          options={["all", "leave", "retro"] as const}
          value={categoryFilter}
          onChange={(v) => {
            setCategoryFilter(v);
            setSelectedIds([]);
          }}
          getLabel={(k) => (k === "all" ? "全部" : CATEGORY_LABEL[k])}
        />
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {loading ? (
        <p className="py-4 text-center text-xs text-text-subtle">加载中…</p>
      ) : list.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">
          {/* 分类筛选下无匹配但与 status tab 下仍有数据时，提示更精确（Issue #156） */}
          {categoryFilter !== "all" && tabList.length > 0
            ? "该分类下暂无申请"
            : tab === "pending"
              ? "暂无待审批申请"
              : "暂无已处理申请"}
        </p>
      ) : (
        <>
          {tab === "pending" && (
            <div className="mb-2 flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-primary"
                />
                全选（{selectedIds.length}/{list.length}）
              </label>
            </div>
          )}
          <div className="max-h-[400px] space-y-2 overflow-y-auto">
            {list.map((item) => {
              const selected = selectedIds.includes(item.id);
              const cat = getLeaveCategory(item);
              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-2 rounded-xl border bg-surface px-3 py-2 cursor-pointer transition ${
                    selected ? "border-primary" : "border-border"
                  }`}
                  onClick={() => setDetailId(item.id)}
                >
                  {tab === "pending" && (
                    <span
                      className="mt-0.5 flex shrink-0 items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelection(item.id)}
                        className="accent-primary"
                      />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text">
                      {item.profiles?.full_name ?? "未知成员"}
                      <span className="ml-1.5 text-xs font-normal text-text-muted">
                        {item.profiles?.instrument ?? ""}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {rehearsalName(item.rehearsals)}
                      {item.rehearsals?.start_time
                        ? ` · ${formatRehearsalRange(
                            item.rehearsals.start_time,
                            item.rehearsals.end_time ?? null,
                          )}`
                        : ""}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-text-subtle">{item.reason}</p>
                  </div>
                  {/* 分类 chip：未结束排练=请假、已结束=补请假（Issue #156） */}
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-1 text-label ${
                      CATEGORY_CHIP[cat]
                    }`}
                  >
                    {CATEGORY_LABEL[cat]}
                  </span>
                  {tab === "processed" && (
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-label ${
                        STATUS_CHIP[item.status] ?? "bg-muted text-text-subtle"
                      }`}
                    >
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 批量操作栏（勾选后出现） */}
          {tab === "pending" && selectedIds.length > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmApproveOpen(true)}
                className="flex-1 rounded-full bg-success px-3 py-1.5 text-label font-medium text-success-foreground hover:opacity-90 disabled:opacity-60"
              >
                批量通过
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejectOpen(true)}
                className="flex-1 rounded-full bg-danger px-3 py-1.5 text-label font-medium text-danger-foreground hover:opacity-90 disabled:opacity-60"
              >
                批量驳回
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelectedIds([])}
                className="rounded-full px-2 py-1.5 text-label text-text-muted hover:bg-border disabled:opacity-60"
              >
                取消选择
              </button>
            </div>
          )}
        </>
      )}

      {/* 批量通过二次确认 */}
      <Modal
        open={confirmApproveOpen}
        onClose={() => {
          if (!busy) setConfirmApproveOpen(false);
        }}
        position="bottom"
        closeOnOverlay={!busy}
      >
        <h3 className="text-base font-semibold text-text">确认批量通过</h3>
        <p className="mt-2 text-sm text-text-muted">
          确定通过选中的 {selectedIds.length} 条请假申请吗？通过后将自动更新对应考勤记录。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmApproveOpen(false)}
            className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleBatchApprove}
            className="rounded-full bg-success px-4 py-2 text-xs font-medium text-success-foreground hover:opacity-90 disabled:opacity-60"
          >
            {batchBusy ? "处理中…" : "确认通过"}
          </button>
        </div>
      </Modal>

      {/* 批量驳回原因弹窗 */}
      <Modal
        open={rejectOpen}
        onClose={() => {
          if (!busy) {
            setRejectOpen(false);
            setRejectError(null);
          }
        }}
        position="bottom"
        closeOnOverlay={!busy}
      >
        <h3 className="text-base font-semibold text-text">批量驳回</h3>
        <p className="mt-2 text-sm text-text-muted">
          驳回原因将应用到选中的 {selectedIds.length} 条申请。
        </p>
        <textarea
          value={rejectReason}
          onChange={(e) => {
            setRejectReason(e.target.value);
            setRejectError(null);
          }}
          rows={3}
          className="input mt-3 w-full resize-none p-3 text-sm leading-[1.5]"
          placeholder="请输入驳回原因（必填）…"
          maxLength={200}
        />
        {rejectError && <p className="mt-1 text-xs text-danger">{rejectError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRejectOpen(false);
              setRejectError(null);
            }}
            className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !rejectReason.trim()}
            onClick={handleBatchReject}
            className="rounded-full bg-danger px-4 py-2 text-xs font-medium text-danger-foreground hover:opacity-90 disabled:opacity-60"
          >
            {batchBusy ? "处理中…" : "确认驳回"}
          </button>
        </div>
      </Modal>

      {/* 详情弹窗 */}
      <LeaveDetailModal
        request={detailRequest}
        onClose={() => setDetailId(null)}
        onApprove={async (id) => {
          // 单条通过透传 approve 结果（含 warnings），由详情弹窗展示提示（Issue #159 返工）
          const result = await approve([id]);
          if (result.ok) setSelectedIds((prev) => prev.filter((x) => x !== id));
          return result;
        }}
        onReject={async (id, reason) => {
          const ok = await reject([id], reason);
          if (ok) setSelectedIds((prev) => prev.filter((x) => x !== id));
          return ok;
        }}
        getSignedUrl={getSignedUrl}
        processing={busy}
      />
    </section>
  );
}
