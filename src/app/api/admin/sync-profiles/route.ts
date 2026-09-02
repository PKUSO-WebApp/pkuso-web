import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

/**
 * 批量同步 profiles API
 * POST /api/admin/sync-profiles
 *
 * 用 member_info 表中的数据全量覆盖更新已有 profiles
 * 仅更新 approved 状态的用户
 */

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

    // 2. 获取所有 member_info
    const { data: memberInfos, error: memberError } = await supabase
      .from("member_info")
      .select("*");

    if (memberError) {
      console.error("[SyncProfiles] 获取 member_info 失败:", memberError.message);
      return NextResponse.json({ error: "获取团员信息失败" }, { status: 500 });
    }

    if (!memberInfos || memberInfos.length === 0) {
      return NextResponse.json({ error: "member_info 表为空" }, { status: 400 });
    }

    // 3. 构建姓名→member_info 的映射
    const memberInfoMap = new Map(memberInfos.map((m) => [m.full_name, m]));

    // 4. 获取所有 approved 状态的 profiles
    const { data: profiles, error: profilesError } = (await supabase
      .from("profiles")
      .select("id, full_name, email, instrument, college")
      .eq("status", "approved")) as {
      data:
        | {
            id: string;
            full_name: string | null;
            email: string | null;
            instrument: string | null;
            college: string | null;
          }[]
        | null;
      error: { message: string } | null;
    };

    if (profilesError) {
      console.error("[SyncProfiles] 获取 profiles 失败:", profilesError.message);
      return NextResponse.json({ error: "获取用户档案失败" }, { status: 500 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ error: "没有已通过的用户" }, { status: 400 });
    }

    // 5. 逐个更新 profiles
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const p of profiles) {
      // 跳过没有姓名的 profile
      if (!p.full_name) {
        skippedCount++;
        continue;
      }

      // 查找对应的 member_info
      const memberInfo = memberInfoMap.get(p.full_name);
      if (!memberInfo) {
        skippedCount++;
        continue;
      }

      // 构建更新字段（全量覆盖，但邮箱为空时不覆盖已有邮箱）
      const updates: Record<string, unknown> = {};

      // 乐器/声部
      if (memberInfo.instrument_name) {
        updates.instrument = memberInfo.instrument_name;
      }

      // 学院
      if (memberInfo.college) {
        updates.college = memberInfo.college;
      }

      // 年级（如果 profiles 有 grade 字段的话）
      // 注意：当前 profiles 表可能没有 grade 字段，这里先保留逻辑
      // if (memberInfo.grade) {
      //   updates.grade = memberInfo.grade;
      // }

      // 邮箱：仅当 member_info 有邮箱且 profiles 邮箱为空时才更新
      // 或者始终覆盖（根据需求：全量覆盖）
      if (memberInfo.email) {
        updates.email = memberInfo.email;
      }

      // 如果没有需要更新的字段，跳过
      if (Object.keys(updates).length === 0) {
        skippedCount++;
        continue;
      }

      // 更新 profiles
      const { error: updateError } = await supabase.from("profiles").update(updates).eq("id", p.id);

      if (updateError) {
        errorCount++;
        errors.push(`${p.full_name}: ${updateError.message}`);
        console.error(`[SyncProfiles] 更新 ${p.full_name} 失败:`, updateError.message);
        continue;
      }

      // 如果邮箱发生变化，同步更新 Auth 层邮箱
      if (updates.email && updates.email !== p.email) {
        try {
          const { error: authUpdateError } = await supabase.auth.admin.updateUserById(p.id, {
            email: updates.email as string,
          });

          if (authUpdateError) {
            console.error(
              `[SyncProfiles] 更新 ${p.full_name} Auth 邮箱失败:`,
              authUpdateError.message,
            );
            // 不计入错误，因为 profiles 层已更新
          }
        } catch (authErr) {
          console.error(`[SyncProfiles] 更新 ${p.full_name} Auth 邮箱异常:`, authErr);
        }
      }

      updatedCount++;
    }

    return NextResponse.json({
      success: true,
      updated: updatedCount,
      skipped: skippedCount,
      errors: errorCount,
      details: errors.length > 0 ? errors : undefined,
      message: `同步完成：更新 ${updatedCount} 人，跳过 ${skippedCount} 人，失败 ${errorCount} 人`,
    });
  } catch (err) {
    console.error("[SyncProfiles] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
