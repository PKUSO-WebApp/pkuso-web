import { describe, expect, it } from "vitest";
import type {
  InstrumentPrincipalRow,
  ProfileRosterRow,
  SectionGroupMemberRow,
  SectionLeaderRow,
  SectionRow,
} from "@/types/database";
import {
  buildLeaderScopes,
  buildPrincipalScopes,
  hasLeaderConflict,
  membersForScope,
  personLabel,
  toLeadershipMembers,
} from "./leadership";

function section(
  name: string,
  kind: "instrument" | "group" | "special",
  sortOrder: number,
  canLead = false,
  canPrincipal = false,
): SectionRow {
  return {
    name,
    kind,
    sort_order: sortOrder,
    can_lead: canLead,
    can_principal: canPrincipal,
    created_at: "2026-10-01T00:00:00Z",
  };
}

function roster(
  id: string,
  fullName: string,
  instrument: string | null,
  status: ProfileRosterRow["status"] = "approved",
  role: ProfileRosterRow["role"] = "member",
): ProfileRosterRow {
  return {
    id,
    full_name: fullName,
    instrument,
    status,
    role,
    avatar_url: null,
    college: null,
    created_at: null,
    email: null,
    hide_college: null,
    hide_email: null,
    hide_join_date: null,
    hide_phone: null,
    is_in_orchestra: true,
    is_principal: false,
    is_section_leader: false,
    join_date: null,
    phone_number: null,
  };
}

function leader(sectionName: string, leaderId: string): SectionLeaderRow {
  return {
    section: sectionName,
    leader_id: leaderId,
    assigned_by: null,
    assigned_at: "2026-10-01T00:00:00Z",
  };
}

function principal(instrument: string, principalId: string): InstrumentPrincipalRow {
  return {
    instrument,
    principal_id: principalId,
    assigned_by: null,
    assigned_at: "2026-10-01T00:00:00Z",
  };
}

const sections = [
  section("长笛", "instrument", 10, true, true),
  section("双簧管", "instrument", 20, true, true),
  section("大管", "instrument", 30, true, true),
  section("木管", "group", 40, true, false),
  section("弦乐", "group", 50, false, false),
];

const groupMembers: SectionGroupMemberRow[] = [
  { group_name: "木管", member_name: "长笛", sort_order: 10 },
  { group_name: "木管", member_name: "双簧管", sort_order: 20 },
  { group_name: "木管", member_name: "大管", sort_order: 30 },
];

const rosterRows = [
  roster("u1", "张三", "长笛"),
  roster("u2", "李四", "长笛"),
  roster("u3", "王五", "双簧管"),
  roster("u4", "赵六", "大管"),
  roster("u5", "待审", "长笛", "pending"),
  roster("u6", "谱务", "长笛", "approved", "score_manager"),
  roster("u7", "管理员", "长笛", "approved", "admin"),
  roster("u8", "无乐器", null),
];

describe("toLeadershipMembers", () => {
  it("只保留 approved + member + 有乐器的人，并补齐 id", () => {
    const members = toLeadershipMembers(rosterRows);
    expect(members.map((member) => member.id).sort()).toEqual(["u1", "u2", "u3", "u4"]);
  });
});

describe("membersForScope", () => {
  const members = toLeadershipMembers(rosterRows);

  it("乐器作用域只选本乐器成员", () => {
    const result = membersForScope(sections[0], groupMembers, members);
    expect(new Set(result.map((member) => member.full_name))).toEqual(new Set(["张三", "李四"]));
  });

  it("组作用域按 section_group_members 展开", () => {
    const result = membersForScope(sections[3], groupMembers, members);
    expect(new Set(result.map((member) => member.full_name))).toEqual(
      new Set(["张三", "李四", "王五", "赵六"]),
    );
  });
});

describe("hasLeaderConflict", () => {
  it("组内任一乐器已有部长 ⇒ 组冲突", () => {
    expect(hasLeaderConflict(sections[3], sections, groupMembers, [leader("长笛", "u1")])).toBe(
      true,
    );
  });

  it("乐器所属组已有部长 ⇒ 乐器冲突", () => {
    expect(hasLeaderConflict(sections[0], sections, groupMembers, [leader("木管", "u3")])).toBe(
      true,
    );
  });

  it("无关作用域的任命不算冲突", () => {
    expect(hasLeaderConflict(sections[0], sections, groupMembers, [leader("双簧管", "u3")])).toBe(
      false,
    );
  });

  it("弦乐这种不可任命组不参与互斥", () => {
    const strings = section("弦乐", "group", 50, false, false);
    expect(hasLeaderConflict(strings, [...sections, strings], groupMembers, [])).toBe(false);
  });
});

describe("buildLeaderScopes / buildPrincipalScopes", () => {
  const members = toLeadershipMembers(rosterRows);

  it("声部长作用域只含 can_lead，并带出现任与冲突", () => {
    const scopes = buildLeaderScopes(sections, groupMembers, [leader("木管", "u3")], members);
    expect(scopes.map((scope) => scope.section.name)).toEqual(["长笛", "双簧管", "大管", "木管"]);
    const flute = scopes.find((scope) => scope.section.name === "长笛");
    expect(flute?.currentLeaderId).toBeNull();
    expect(flute?.conflict).toBe(true);
    const woodwind = scopes.find((scope) => scope.section.name === "木管");
    expect(woodwind?.currentLeaderId).toBe("u3");
    expect(woodwind?.conflict).toBe(false);
  });

  it("首席作用域只含 can_principal 的乐器，并带出现任", () => {
    const scopes = buildPrincipalScopes(sections, [principal("长笛", "u1")], members);
    expect(scopes.map((scope) => scope.section.name)).toEqual(["长笛", "双簧管", "大管"]);
    expect(scopes.find((scope) => scope.section.name === "长笛")?.currentPrincipalId).toBe("u1");
    expect(scopes.find((scope) => scope.section.name === "双簧管")?.currentPrincipalId).toBeNull();
  });
});

describe("personLabel", () => {
  it("乐器作用域只显示姓名；组作用域才补乐器；查不到时给兜底", () => {
    expect(personLabel(rosterRows, "u1")).toBe("张三");
    expect(personLabel(rosterRows, "u1", true)).toBe("张三（长笛）");
    expect(personLabel(rosterRows, null)).toBe("未任命");
    expect(personLabel(rosterRows, "missing")).toBe("未知成员");
  });
});
