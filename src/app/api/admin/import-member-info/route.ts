import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import {
  INSTRUMENT_ALIAS_MAP,
  normalizeProfileInstrument,
  resolveInstrumentName,
} from "@/constants/instrument-aliases";

/**
 * 导入团员信息 API
 * POST /api/admin/import-member-info
 *
 * 接收 Excel 文件，解析后导入到 member_info 表
 * 支持全量替换模式（先 TRUNCATE 再 INSERT）
 */

type FieldMapping = {
  excel_header: string;
  target_field: string;
};

type MemberInfoRow = {
  full_name: string;
  instrument_code?: number;
  instrument_name?: string;
  email?: string;
  college?: string;
  grade?: string;
};

export async function POST(request: Request) {
  const supabase = createServerSupabase();

  try {
    // 1. 认证 + 授权
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    if (!token) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    // 2. 解析请求体
    const body = await request.json();
    const { rows } = body as { rows: Record<string, unknown>[] };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "缺少导入数据" }, { status: 400 });
    }

    // 3. 获取导入配置
    const { data: config, error: configError } = await supabase
      .from("import_config")
      .select("*")
      .eq("id", 1)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: "未找到导入配置，请先配置字段映射" }, { status: 400 });
    }

    const fieldMapping = config.field_mapping as FieldMapping[];
    const instrumentMap = config.instrument_map as Record<string, string>;

    if (!fieldMapping || fieldMapping.length === 0) {
      return NextResponse.json({ error: "字段映射配置为空" }, { status: 400 });
    }

    // 4. 解析并校验数据
    const parsedRows: MemberInfoRow[] = [];
    const errors: string[] = [];
    // 行级警告：不阻断导入，但要告诉用户这一行被归成了「其他」
    const warnings: string[] = [];
    const fullNames = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel 行号（假设第一行是表头）

      // 解析姓名
      let fullName = "";
      for (const mapping of fieldMapping) {
        if (mapping.target_field === "full_name") {
          fullName = String(row[mapping.excel_header] ?? "").trim();
          break;
        }
      }

      if (!fullName) {
        errors.push(`第 ${rowNum} 行：姓名为空`);
        continue;
      }

      // 检查 Excel 内部是否有重复姓名
      if (fullNames.has(fullName)) {
        errors.push(`第 ${rowNum} 行：姓名"${fullName}"重复`);
        continue;
      }
      fullNames.add(fullName);

      // 解析声部：支持数字序号或直接名称/别名，无法识别时 fallback 为"其他"
      let instrumentCode: number | undefined;
      let instrumentName: string | undefined;
      for (const mapping of fieldMapping) {
        if (mapping.target_field === "instrument_code") {
          const rawValue = String(row[mapping.excel_header] ?? "").trim();
          if (!rawValue) {
            // 空值跳过
            break;
          }

          // 尝试作为数字序号解析
          const numValue = Number(rawValue);
          if (!isNaN(numValue) && Number.isInteger(numValue)) {
            instrumentCode = numValue;
            instrumentName = instrumentMap[String(instrumentCode)];
            if (!instrumentName) {
              // 序号无法映射，fallback 为"其他"
              instrumentName = "其他";
            }
          } else {
            // 非数字，尝试作为声部名称/别名匹配
            const resolved = resolveInstrumentName(rawValue);
            if (resolved !== rawValue || INSTRUMENT_ALIAS_MAP[rawValue]) {
              instrumentName = resolved;
            } else {
              // 无法识别，fallback 为"其他"
              instrumentName = "其他";
            }
          }
          break;
        }
      }

      // 严格校验：member_info 的值最终会被 sync-profiles / 审批预填写进
      // profiles.instrument，而 DB 已开严格触发器，所以必须在源头归一。
      // 无法归一的值沿用现有 fallback：按「其他」落库，并留一条行级警告。
      if (instrumentName) {
        const normalized = normalizeProfileInstrument(instrumentName);
        if (normalized) {
          instrumentName = normalized;
        } else {
          warnings.push(
            `第 ${rowNum} 行：声部「${instrumentName}」不在标准列表内，已按「其他」处理`,
          );
          instrumentName = "其他";
        }
      }

      // 解析邮箱
      let email: string | undefined;
      for (const mapping of fieldMapping) {
        if (mapping.target_field === "email") {
          email = String(row[mapping.excel_header] ?? "").trim() || undefined;
          break;
        }
      }

      // 解析学院
      let college: string | undefined;
      for (const mapping of fieldMapping) {
        if (mapping.target_field === "college") {
          college = String(row[mapping.excel_header] ?? "").trim() || undefined;
          break;
        }
      }

      // 解析年级
      let grade: string | undefined;
      for (const mapping of fieldMapping) {
        if (mapping.target_field === "grade") {
          grade = String(row[mapping.excel_header] ?? "").trim() || undefined;
          break;
        }
      }

      parsedRows.push({
        full_name: fullName,
        instrument_code: instrumentCode,
        instrument_name: instrumentName,
        email,
        college,
        grade,
      });
    }

    // 如果有校验错误，返回错误（不导入）
    if (errors.length > 0) {
      return NextResponse.json({ error: "数据校验失败", details: errors }, { status: 400 });
    }

    // 5. 全量替换：DELETE + INSERT
    // 先验证新数据有效后再执行替换
    if (parsedRows.length === 0) {
      return NextResponse.json({ error: "无有效数据可导入" }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from("member_info")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteError) {
      console.error("[ImportMemberInfo] 清空旧数据失败:", deleteError.message);
      return NextResponse.json({ error: "清空旧数据失败" }, { status: 500 });
    }

    // 插入新数据
    const { error: insertError } = await supabase.from("member_info").insert(
      parsedRows.map((row) => ({
        full_name: row.full_name,
        instrument_code: row.instrument_code ?? null,
        instrument_name: row.instrument_name ?? null,
        email: row.email ?? null,
        college: row.college ?? null,
        grade: row.grade ?? null,
      })),
    );

    if (insertError) {
      console.error("[ImportMemberInfo] 插入新数据失败:", insertError.message);
      return NextResponse.json({ error: "插入新数据失败" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      imported: parsedRows.length,
      message: `成功导入 ${parsedRows.length} 条团员信息`,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err) {
    console.error("[ImportMemberInfo] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
