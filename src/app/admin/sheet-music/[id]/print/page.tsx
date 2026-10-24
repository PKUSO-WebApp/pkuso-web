"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import {
  buildManifest,
  groupPrintPlan,
  summarizePrintPlan,
  type PrintPlanRow,
} from "../../print-plan";
import { buildPrintZip, downloadBlob, printZipName } from "../../print-zip";

/**
 * 印制清单（P7b）：谱务按声部/文件核对「本声部人数、已分配人数、应印份数」，
 * 逐文件调整份数，最后导出一个改名后的压缩包。
 *
 * 自动份数由后端 `get_score_print_plan` 算；这里的手动改动走
 * `set_print_copies`（null = 恢复自动）。导出前会把输入框里还没落库的值先保存，
 * 避免「刚改完就点导出，压缩包里还是旧数字」。
 */
export default function PrintPlanPage() {
  const params = useParams();
  const router = useRouter();
  const { setTitle, setOnBack } = useAdminPageHeader();
  const scoreId = String(params.id ?? "");

  const [scoreTitle, setScoreTitle] = useState("");
  const [rows, setRows] = useState<PrintPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** 输入框里还没落库的字符串（受控输入；空串允许，失焦时校验） */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [includeManifest, setIncludeManifest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    setTitle("印制清单");
    setOnBack(() => router.back());
  }, [setTitle, setOnBack, router]);

  const load = useCallback(async () => {
    if (!scoreId) return;
    setLoading(true);
    setError("");
    const [scoreRes, planRes] = await Promise.all([
      supabase.from("sheet_music").select("title").eq("id", scoreId).single(),
      supabase.rpc("get_score_print_plan", { p_score_id: scoreId }),
    ]);
    if (scoreRes.error || planRes.error) {
      setError(scoreRes.error?.message ?? planRes.error?.message ?? "加载失败");
      setLoading(false);
      return;
    }
    setScoreTitle(scoreRes.data?.title ?? "");
    // 生成类型把 assigned_members / manual_copies 标成非空（SQL 里可为 null），只在这一层放宽
    setRows((planRes.data ?? []) as unknown as PrintPlanRow[]);
    setDraft({});
    setLoading(false);
  }, [scoreId]);

  useEffect(() => {
    // 进页面先显示加载态是这一类页面的既定行为；首屏拉取在 effect 里发起
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const groups = useMemo(() => groupPrintPlan(rows), [rows]);
  const summary = useMemo(() => summarizePrintPlan(rows), [rows]);

  const setSavingRow = (fileId: string, on: boolean) => {
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(fileId);
      else next.delete(fileId);
      return next;
    });
  };

  const clearDraft = (fileId: string) => {
    setDraft((prev) => {
      if (!(fileId in prev)) return prev;
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  };

  /** 落库一个值；null = 恢复自动。成功时同步本地行。 */
  const saveValue = async (row: PrintPlanRow, value: number | null): Promise<boolean> => {
    setSavingRow(row.file_id, true);
    const { error: saveError } = await supabase.rpc("set_print_copies", {
      p_file_id: row.file_id,
      // 生成类型不表达可空（SQL 里 null = 恢复自动）
      p_copies: value as never,
    });
    setSavingRow(row.file_id, false);
    if (saveError) {
      alert(`保存失败：${saveError.message}`);
      await load();
      return false;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.file_id === row.file_id
          ? { ...r, manual_copies: value, copies: value ?? r.auto_copies }
          : r,
      ),
    );
    return true;
  };

  /** 读取一个输入框的草稿：none = 没改；invalid = 非法；value = 要保存的值 */
  const readDraft = (
    row: PrintPlanRow,
  ): { kind: "none" } | { kind: "invalid" } | { kind: "value"; value: number } => {
    const raw = draft[row.file_id];
    if (raw === undefined) return { kind: "none" };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return { kind: "invalid" };
    return { kind: "value", value: n };
  };

  const commitRow = async (row: PrintPlanRow) => {
    const read = readDraft(row);
    if (read.kind === "none") return;
    if (read.kind === "invalid") {
      clearDraft(row.file_id);
      return;
    }
    if (read.value === row.copies) {
      clearDraft(row.file_id);
      return;
    }
    const ok = await saveValue(row, read.value);
    if (ok) clearDraft(row.file_id);
  };

  const restoreAuto = async (row: PrintPlanRow) => {
    clearDraft(row.file_id);
    await saveValue(row, null);
  };

  /**
   * 导出前把所有草稿落库，并返回「落库后的行」——不能直接读 rows：
   * React 的 setState 是异步的，刚保存的值还没回到这次闭包里的 rows。
   */
  const flushDrafts = async (): Promise<PrintPlanRow[] | null> => {
    const effective = [...rows];
    for (let i = 0; i < effective.length; i += 1) {
      const row = effective[i];
      const read = readDraft(row);
      if (read.kind === "none") continue;
      if (read.kind === "invalid") {
        alert("应印份数必须是 0 或正整数");
        return null;
      }
      if (read.value === row.copies) {
        clearDraft(row.file_id);
        continue;
      }
      const ok = await saveValue(row, read.value);
      if (!ok) return null;
      clearDraft(row.file_id);
      effective[i] = { ...row, manual_copies: read.value, copies: read.value };
    }
    return effective;
  };

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const effective = await flushDrafts();
      if (!effective) return;
      const entries = effective
        .filter((row) => row.copies > 0)
        .map((row) => ({
          file_name: row.file_name,
          storage_path: row.storage_path,
          copies: row.copies,
        }));
      if (entries.length === 0) {
        alert("没有需要印的文件（份数都是 0）");
        return;
      }
      setProgress({ done: 0, total: entries.length });
      const blob = await buildPrintZip({
        entries,
        manifest: includeManifest ? buildManifest(scoreTitle, effective) : undefined,
        load: async (storagePath) => {
          const { data, error: downloadError } = await supabase.storage
            .from(STORAGE_BUCKETS.sheetMusic)
            .download(storagePath);
          if (downloadError || !data) {
            throw new Error(downloadError?.message ?? "下载乐谱失败");
          }
          return data.arrayBuffer();
        },
        onProgress: (done, total) => setProgress({ done, total }),
      });
      downloadBlob(blob, printZipName(scoreTitle));
    } catch (err) {
      alert(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
      setProgress(null);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-text-muted">加载中...</div>;
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-danger">{error}</p>
        <button
          onClick={() => void load()}
          className="rounded-lg border border-border px-4 py-2 text-sm text-text"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
        <div className="bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-sm text-text">
            {summary.fileCount} 个文件待印 · 合计 {summary.totalCopies} 份
          </p>
          <p className="mt-1 text-xs text-text-muted">
            应印份数按成员默认分声部自动计算；可直接修改，改过的行标「手动」。
          </p>
        </div>

        {groups.length === 0 ? (
          <div className="rounded-lg border border-border py-12 text-center text-text-muted">
            这首曲子还没有分谱文件
          </div>
        ) : (
          groups.map((group) => (
            <div
              key={group.section}
              className="bg-card border border-border rounded-lg overflow-hidden"
            >
              <div className="px-4 py-2 bg-muted/50 border-b border-border">
                <span className="font-medium text-text">{group.section}</span>
                <span className="ml-2 text-xs text-text-muted">
                  {group.kind === "part"
                    ? `本声部 ${group.sectionMembers} 人`
                    : group.kind === "score"
                      ? "默认 1 份，可修改"
                      : "每个文件默认 1 份，可修改"}
                </span>
              </div>
              <div className="divide-y divide-border">
                {group.rows.map((row) => {
                  const isSaving = saving.has(row.file_id);
                  const value = draft[row.file_id] ?? String(row.copies);
                  const noMembers = group.kind === "part" && (row.assigned_members ?? 0) === 0;
                  return (
                    <div key={row.file_id} className="px-4 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-text">{row.file_name}</p>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {row.sub_parts.length > 0
                              ? `分声部 ${row.sub_parts.join(",")}`
                              : "全声部"}
                            {group.kind === "part"
                              ? ` · 已分配 ${row.assigned_members ?? 0} 人`
                              : ""}
                            {isSaving ? " · 保存中..." : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {row.manual_copies != null ? (
                            <span className="text-xs text-warning">
                              手动（自动 {row.auto_copies}）
                            </span>
                          ) : null}
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={value}
                            disabled={isSaving}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, [row.file_id]: e.target.value }))
                            }
                            onBlur={() => void commitRow(row)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            aria-label={`${row.file_name} 应印份数`}
                            className="w-20 rounded-lg border border-border bg-card px-2 py-1 text-right text-sm text-text"
                          />
                          <span className="text-xs text-text-muted">份</span>
                          {row.manual_copies != null ? (
                            <button
                              onClick={() => void restoreAuto(row)}
                              disabled={isSaving}
                              className="text-xs text-primary hover:underline disabled:opacity-50"
                            >
                              恢复自动
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {noMembers ? (
                        <p className="mt-1 text-xs text-warning">该声部没有分配成员，自动按 1 份</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border bg-surface px-4 py-3">
        <label className="mb-2 flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={includeManifest}
            onChange={(e) => setIncludeManifest(e.target.checked)}
          />
          附清单.txt（声部 / 人数 / 已分配 / 份数）
        </label>
        <button
          onClick={() => void onExport()}
          disabled={exporting || saving.size > 0 || rows.length === 0}
          className="w-full rounded-lg bg-primary py-3 text-sm text-primary-foreground disabled:opacity-50"
        >
          {exporting
            ? progress
              ? `正在打包 ${progress.done}/${progress.total}...`
              : "正在准备..."
            : `导出压缩包（${summary.fileCount} 个文件 / ${summary.totalCopies} 份）`}
        </button>
      </div>
    </div>
  );
}
