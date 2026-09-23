/** 乐团声部展示顺序:严格按此顺序分组,命中者各成一组,未命中归入「其他」 */
export const INSTRUMENT_ORDER = [
  "第一小提琴",
  "第二小提琴",
  "中提琴",
  "大提琴",
  "低音提琴",
  "长笛",
  "双簧管",
  "单簧管",
  "大管",
  "圆号",
  "小号",
  "长号",
  "大号",
  "打击乐",
  "键盘",
  "竖琴",
] as const;

export type Instrument = (typeof INSTRUMENT_ORDER)[number];

export const OTHER_INSTRUMENT_GROUP = "其他";

/**
 * 「总谱」——**它不是声部**，而是「整份谱（所有声部都在里面）」的标记。
 *
 * ⚠️ 与 `OTHER_INSTRUMENT_GROUP` 并列做**特殊值**，**刻意不进 `INSTRUMENT_ORDER`**：
 * 那张表是给成员分声部用的（成员只会属于其中某一个），总谱不属于任何一个。
 * 谱务里它可以作为 `sheet_music_parts.section` 的值存在，所以凡是校验 section
 * 合法性的地方（如 `isKnownSection`）都要与「其他」一起认它。
 *
 * 详情页排序把它放**最前**（见 `sort-parts.ts`）—— 总谱是「整份」，排在分谱之前
 * 符合阅读顺序。
 */
export const FULL_SCORE_SECTION = "总谱";

/** 声部组：用于分排创建时的联想列表分组、小程序端显示声部组名 */
export const SECTION_GROUPS = {
  弦乐: ["第一小提琴", "第二小提琴", "中提琴", "大提琴", "低音提琴"],
  木管: ["大管", "双簧管", "长笛", "单簧管"],
  铜管: ["小号", "长号", "圆号", "大号"],
  管乐: ["大管", "双簧管", "长笛", "单簧管", "小号", "长号", "圆号", "大号"],
} as const;

export type SectionGroup = keyof typeof SECTION_GROUPS;

/** 扁平化的所有声部列表（用于联想搜索） */
export const ALL_SECTIONS = [...new Set(Object.values(SECTION_GROUPS).flat())] as readonly string[];

/**
 * 将选中的声部列表转换为邮件显示字符串。
 * 如果选中的声部恰好构成某个声部组的全部成员，则使用组名替代。
 */
export function sectionsToDisplayString(sections: string[]): string {
  if (sections.length === 0) return "";
  const selectedSet = new Set(sections);
  const usedGroups: string[] = [];
  const usedInstruments = new Set<string>();

  for (const [groupName, groupSections] of Object.entries(SECTION_GROUPS)) {
    if (groupName === "管乐") continue;
    if (groupSections.every((s) => selectedSet.has(s))) {
      usedGroups.push(groupName);
      groupSections.forEach((s) => usedInstruments.add(s));
    }
  }

  const remaining = sections.filter((s) => !usedInstruments.has(s));
  return [...usedGroups, ...remaining].join(",");
}

/**
 * 将包含声部组名的字符串展开为个人声部列表（用于 API 过滤收件人）。
 */
export function expandSectionGroups(sectionStr: string): string[] {
  const parts = sectionStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const result: string[] = [];
  for (const part of parts) {
    if (part in SECTION_GROUPS) {
      result.push(...SECTION_GROUPS[part as SectionGroup]);
    } else {
      result.push(part);
    }
  }
  return [...new Set(result)];
}
