"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, Plus, Trash2, ListPlus } from "lucide-react";
import { resolveInstrumentName } from "@/constants/instrument-aliases";

/** 后端定义的可选字段 */
const AVAILABLE_FIELDS = [
  { value: "skip", label: "跳过此列（不导入）" },
  { value: "full_name", label: "姓名" },
  { value: "email", label: "邮箱" },
  { value: "instrument_code", label: "乐器/声部" },
  { value: "college", label: "学院" },
  { value: "grade", label: "年级" },
];

/** 根据列头关键词自动识别字段 */
function autoDetectField(header: string): string {
  if (header.includes("声部")) return "instrument_code";
  if (header.includes("姓名")) return "full_name";
  if (header.includes("邮箱") || header.includes("邮件")) return "email";
  if (header.includes("学院")) return "college";
  if (header.includes("年级")) return "grade";
  return "skip";
}

type FieldMapping = {
  excel_header: string;
  target_field: string;
};

type InstrumentMapping = {
  code: number;
  name: string;
};

export default function ImportConfigPage() {
  const router = useRouter();

  // 字段映射状态
  const [fieldMappings, setFieldMappings] = React.useState<FieldMapping[]>([]);
  // 声部映射状态
  const [instrumentMappings, setInstrumentMappings] = React.useState<InstrumentMapping[]>([]);
  // Excel 文件名（仅用于显示）
  const [excelFileName, setExcelFileName] = React.useState<string>("");
  // 加载状态
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // 错误信息
  const [error, setError] = React.useState<string | null>(null);
  // 成功提示
  const [success, setSuccess] = React.useState<string | null>(null);

  // 加载现有配置
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { supabase } = await import("@/lib/supabase");
        const { data, error } = await supabase
          .from("import_config")
          .select("*")
          .eq("id", 1)
          .single();

        if (cancelled) return;

        if (error && error.code !== "PGRST116") {
          console.error("加载配置失败:", error);
          return;
        }

        if (data) {
          setFieldMappings((data.field_mapping as FieldMapping[]) || []);
          setInstrumentMappings(
            Object.entries((data.instrument_map as Record<string, string>) || {}).map(
              ([code, name]) => ({
                code: parseInt(code),
                name,
              }),
            ),
          );
        }
      } catch (err) {
        if (!cancelled) console.error("加载配置异常:", err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 处理 Excel 文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelFileName(file.name);
    setLoading(true);
    setError(null);

    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // 获取表头（第一行）
      const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
      const headers: string[] = [];

      for (let col = range.s.c; col <= range.e.c; col++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
        headers.push(cell?.v?.toString() || "");
      }

      // 自动识别并生成映射
      const newMappings: FieldMapping[] = headers
        .filter((h) => h.trim() !== "")
        .map((header) => ({
          excel_header: header,
          target_field: autoDetectField(header),
        }));

      setFieldMappings(newMappings);
    } catch (err) {
      setError(`解析 Excel 失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // 更新字段映射
  const updateFieldMapping = (index: number, targetField: string) => {
    setFieldMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, target_field: targetField } : m)),
    );
  };

  // 删除字段映射
  const removeFieldMapping = (index: number) => {
    setFieldMappings((prev) => prev.filter((_, i) => i !== index));
  };

  // 添加声部映射
  const addInstrumentMapping = () => {
    const maxCode = instrumentMappings.reduce((max, m) => Math.max(max, m.code), 0);
    setInstrumentMappings((prev) => [...prev, { code: maxCode + 1, name: "" }]);
  };

  // 更新声部映射
  const updateInstrumentMapping = (index: number, field: "code" | "name", value: string) => {
    setInstrumentMappings((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, [field]: field === "code" ? parseInt(value) || 0 : value } : m,
      ),
    );
  };

  // 删除声部映射
  const removeInstrumentMapping = (index: number) => {
    setInstrumentMappings((prev) => prev.filter((_, i) => i !== index));
  };

  // 批量导入声部
  const [batchInput, setBatchInput] = React.useState("");
  const [showBatchInput, setShowBatchInput] = React.useState(false);

  const handleBatchImport = () => {
    const lines = batchInput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      setError("请输入至少一个声部名称");
      return;
    }

    // 解析别名并去重
    const resolved = lines.map((line) => resolveInstrumentName(line));
    const unique = [...new Set(resolved)];

    // 检查是否有空名称
    if (unique.some((name) => !name)) {
      setError("存在空的声部名称，请检查输入");
      return;
    }

    // 从当前最大序号继续编号
    const startCode = instrumentMappings.reduce((max, m) => Math.max(max, m.code), 0) + 1;

    const newMappings: InstrumentMapping[] = unique.map((name, i) => ({
      code: startCode + i,
      name,
    }));

    setInstrumentMappings((prev) => [...prev, ...newMappings]);
    setBatchInput("");
    setShowBatchInput(false);
  };

  // 保存配置
  const handleSave = async () => {
    // 校验
    if (fieldMappings.length === 0) {
      setError("请先上传 Excel 文件或添加字段映射");
      return;
    }

    // 检查必填字段是否有映射
    const mappedFields = fieldMappings.map((m) => m.target_field);
    if (!mappedFields.includes("full_name")) {
      setError("请至少映射「姓名」字段");
      return;
    }

    // 检查声部映射是否有重复序号
    const codes = instrumentMappings.map((m) => m.code);
    if (new Set(codes).size !== codes.length) {
      setError("声部映射中存在重复序号");
      return;
    }

    // 检查声部映射是否有空名称
    if (instrumentMappings.some((m) => !m.name.trim())) {
      setError("声部映射中存在空的乐器名称");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { supabase } = await import("@/lib/supabase");

      // 构建 instrument_map JSON
      const instrumentMap: Record<number, string> = {};
      instrumentMappings.forEach((m) => {
        instrumentMap[m.code] = m.name;
      });

      const { error: upsertError } = await supabase.from("import_config").upsert(
        {
          id: 1,
          field_mapping: fieldMappings,
          instrument_map: instrumentMap,
          year: new Date().getFullYear(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (upsertError) {
        throw upsertError;
      }

      setSuccess("配置保存成功");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      {/* 头部 */}
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-full bg-muted p-2 hover:bg-border"
        >
          <ArrowLeft className="h-5 w-5 text-text-muted" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-text">导入配置</h1>
          <p className="text-xs text-text-muted">配置团员信息导入的字段映射和声部映射</p>
        </div>
      </header>

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
        {/* 步骤1：字段映射 */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium text-text">步骤1：字段映射</h2>

          {/* 文件上传 */}
          <div className="mb-4">
            <label
              htmlFor="excel-upload"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface p-4 text-sm text-text-muted hover:border-primary/50 hover:bg-muted"
            >
              <Upload className="h-5 w-5" />
              {excelFileName || "上传 Excel 样本文件（可选）"}
            </label>
            <input
              id="excel-upload"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {/* 映射列表 */}
          {fieldMappings.length > 0 ? (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_150px_32px] gap-2 text-xs font-medium text-text-muted">
                <span>问卷列头</span>
                <span>对应字段</span>
                <span />
              </div>
              {fieldMappings.map((mapping, index) => (
                <div key={index} className="grid grid-cols-[1fr_150px_32px] items-center gap-2">
                  <span className="truncate text-sm text-text" title={mapping.excel_header}>
                    {mapping.excel_header}
                  </span>
                  <select
                    value={mapping.target_field}
                    onChange={(e) => updateFieldMapping(index, e.target.value)}
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {AVAILABLE_FIELDS.map((field) => (
                      <option key={field.value} value={field.value}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeFieldMapping(index)}
                    className="rounded p-1 text-text-muted hover:bg-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-xs text-text-muted">
              {loading ? "解析中..." : "上传 Excel 文件或手动添加映射"}
            </p>
          )}
        </section>

        {/* 步骤2：声部映射 */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-text">步骤2：声部映射</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBatchInput(!showBatchInput)}
                className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs text-text-muted hover:bg-border"
              >
                <ListPlus className="h-3 w-3" />
                批量添加
              </button>
              <button
                type="button"
                onClick={addInstrumentMapping}
                className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
              >
                <Plus className="h-3 w-3" />
                添加
              </button>
            </div>
          </div>

          {/* 批量导入区域 */}
          {showBatchInput && (
            <div className="mb-3 rounded-xl border border-border bg-surface p-3">
              <p className="mb-2 text-xs text-text-muted">
                每行一个声部名称，支持别名（如「一提」会自动解析为「第一小提琴」）
              </p>
              <textarea
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                placeholder={
                  "一提\n二提\n中提\n大提\nBass\n打击乐\n竖琴\n单簧管\n长笛\n双簧管\n巴松\n圆号\n长号\n大号\n小号"
                }
                rows={8}
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBatchInput("");
                    setShowBatchInput(false);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:bg-muted"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleBatchImport}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  确认添加
                </button>
              </div>
            </div>
          )}

          {instrumentMappings.length > 0 ? (
            <div className="space-y-2">
              <div className="grid grid-cols-[60px_1fr_32px] gap-2 text-xs font-medium text-text-muted">
                <span>序号</span>
                <span>乐器名称</span>
                <span />
              </div>
              {instrumentMappings.map((mapping, index) => (
                <div key={index} className="grid grid-cols-[60px_1fr_32px] items-center gap-2">
                  <input
                    type="number"
                    value={mapping.code || ""}
                    onChange={(e) => updateInstrumentMapping(index, "code", e.target.value)}
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
                    min={0}
                  />
                  <input
                    type="text"
                    value={mapping.name}
                    onChange={(e) => updateInstrumentMapping(index, "name", e.target.value)}
                    placeholder="如：女高音"
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => removeInstrumentMapping(index)}
                    className="rounded p-1 text-text-muted hover:bg-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-xs text-text-muted">
              暂无声部映射，点击「添加」按钮新增
            </p>
          )}
        </section>
      </div>

      {/* 底部按钮 */}
      <div className="flex-shrink-0 border-t border-border bg-surface p-4">
        {error && <p className="mb-2 text-center text-xs text-danger">{error}</p>}
        {success && <p className="mb-2 text-center text-xs text-success">{success}</p>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存配置"}
        </button>
      </div>
    </div>
  );
}
