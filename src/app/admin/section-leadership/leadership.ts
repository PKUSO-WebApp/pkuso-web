import type {
  InstrumentPrincipalRow,
  ProfileRosterRow,
  SectionGroupMemberRow,
  SectionLeaderRow,
  SectionRow,
} from "@/types/database";

/**
 * P0c 的纯逻辑：把三张角色表 + 声部字典 + 花名册拼成「作用域 → 候选人 / 现任 / 冲突」。
 *
 * 这些规则必须与 backend 的 admin RPC 保持一致（P0b）：
 * - 成员资格：approved + role='member' + 有 instrument；
 * - 乐器作用域只选本乐器成员；组作用域按 section_group_members 展开；
 * - 组与组内乐器互斥（组有部长 ⇒ 组内乐器不能再设；组内任一乐器有部长 ⇒ 组不能再设）。
 *
 * 这里只做展示与禁用，真正的拒绝仍在 RPC（service_role + assert_admin_actor）。
 */

export type LeadershipMember = {
  id: string;
  full_name: string | null;
  instrument: string | null;
};

/** 团长能力矩阵（2026-10-25 固定六项）；backend `president_capability_keys()` 同源。 */
export const PRESIDENT_CAPABILITY_LABELS: Record<string, string> = {
  rehearsal: "排练管理",
  leave_approval: "请假审批",
  membership_approval: "入团审批",
  attendance: "修改考勤",
  attendance_approval: "考勤修改申请审批",
  attendance_export: "考勤导出",
};

export type LeaderScope = {
  section: SectionRow;
  members: LeadershipMember[];
  currentLeaderId: string | null;
  conflict: boolean;
};

export type PrincipalScope = {
  section: SectionRow;
  members: LeadershipMember[];
  currentPrincipalId: string | null;
};

/** 花名册 → 可任命的成员（与 RPC 的 target_not_eligible 判据一致） */
export function toLeadershipMembers(roster: ProfileRosterRow[]): LeadershipMember[] {
  return roster
    .filter(
      (row) =>
        row.id != null &&
        row.status === "approved" &&
        (row.role ?? "member") === "member" &&
        (row.instrument ?? "").trim() !== "",
    )
    .map((row) => ({ id: row.id as string, full_name: row.full_name, instrument: row.instrument }))
    .sort((a, b) => {
      const byInstrument = String(a.instrument ?? "").localeCompare(
        String(b.instrument ?? ""),
        "zh-CN",
      );
      if (byInstrument !== 0) return byInstrument;
      return String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "zh-CN");
    });
}

/** 某个作用域的候选人：乐器精确匹配；组按字典展开 */
/** 从完整花名册按 id 取人；用于现任团长可能已不在「可任命」过滤集里的情况。 */
export function findLeadershipMember(
  roster: ProfileRosterRow[],
  userId: string | null,
): LeadershipMember | null {
  if (!userId) return null;
  const row = roster.find((item) => item.id === userId);
  if (!row?.id) return null;
  return { id: row.id, full_name: row.full_name, instrument: row.instrument };
}

export function membersForScope(
  section: SectionRow,
  groupMembers: SectionGroupMemberRow[],
  members: LeadershipMember[],
): LeadershipMember[] {
  if (section.kind === "instrument") {
    return members.filter((member) => member.instrument === section.name);
  }
  const names = new Set(
    groupMembers.filter((row) => row.group_name === section.name).map((row) => row.member_name),
  );
  return members.filter((member) => names.has(String(member.instrument ?? "")));
}

/**
 * 组/乐器互斥。
 *
 * - 组作用域：组内任一乐器已有声部长 ⇒ 冲突；
 * - 乐器作用域：包含它的任一可任命组已有声部长 ⇒ 冲突。
 *
 * 注意：冲突与「当前作用域自己有没有部长」是两件事。已有部长的作用域仍可能因为
 * 历史数据同时存在组/乐器任命而冲突；UI 会允许撤销，但禁止更换（RPC 也会拒）。
 */
export function hasLeaderConflict(
  section: SectionRow,
  sections: SectionRow[],
  groupMembers: SectionGroupMemberRow[],
  leaders: SectionLeaderRow[],
): boolean {
  const leaderSections = new Set(leaders.map((row) => row.section));
  if (section.kind === "group") {
    return groupMembers.some(
      (row) => row.group_name === section.name && leaderSections.has(row.member_name),
    );
  }
  return sections
    .filter((row) => row.kind === "group" && row.can_lead)
    .some(
      (group) =>
        leaderSections.has(group.name) &&
        groupMembers.some(
          (row) => row.group_name === group.name && row.member_name === section.name,
        ),
    );
}

export function buildLeaderScopes(
  sections: SectionRow[],
  groupMembers: SectionGroupMemberRow[],
  leaders: SectionLeaderRow[],
  members: LeadershipMember[],
): LeaderScope[] {
  return sections
    .filter((section) => section.can_lead)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((section) => ({
      section,
      members: membersForScope(section, groupMembers, members),
      currentLeaderId: leaders.find((row) => row.section === section.name)?.leader_id ?? null,
      conflict: hasLeaderConflict(section, sections, groupMembers, leaders),
    }));
}

export function buildPrincipalScopes(
  sections: SectionRow[],
  principals: InstrumentPrincipalRow[],
  members: LeadershipMember[],
): PrincipalScope[] {
  return sections
    .filter((section) => section.kind === "instrument" && section.can_principal)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((section) => ({
      section,
      members: membersForScope(section, [], members),
      currentPrincipalId:
        principals.find((row) => row.instrument === section.name)?.principal_id ?? null,
    }));
}

/**
 * 现任显示：优先用花名册里的姓名；查不到（已退团/改角色）时给出可辨认的兜底。
 *
 * 乐器作用域的标题本身就是乐器，姓名后再缀 `（第一小提琴）` 是重复信息；
 * 组作用域（木管/铜管）标题只是组名，保留乐器能说明这位部长是哪件乐器的。
 */
export function personLabel(
  roster: ProfileRosterRow[],
  userId: string | null,
  showInstrument = false,
): string {
  if (!userId) return "未任命";
  const person = roster.find((row) => row.id === userId);
  if (!person) return "未知成员";
  const name = person.full_name?.trim() || "未填写姓名";
  const instrument = person.instrument?.trim();
  return showInstrument && instrument ? `${name}（${instrument}）` : name;
}
