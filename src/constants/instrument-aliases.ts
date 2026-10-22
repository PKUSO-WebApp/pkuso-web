import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from "./instruments";

/**
 * 声部别名映射：缩写/别名 → 规范中文名
 * 用于管理端配置页面批量导入时自动解析
 * 以及小程序端搜索匹配
 */
export const INSTRUMENT_ALIAS_MAP: Record<string, string> = {
  // 弦乐
  一提: "第一小提琴",
  一小: "第一小提琴",
  第一小提琴: "第一小提琴",
  "1st violin": "第一小提琴",
  二提: "第二小提琴",
  二小: "第二小提琴",
  第二小提琴: "第二小提琴",
  "2nd violin": "第二小提琴",
  中提: "中提琴",
  中提琴: "中提琴",
  viola: "中提琴",
  大提: "大提琴",
  大提琴: "大提琴",
  cello: "大提琴",
  低音提: "低音提琴",
  低音提琴: "低音提琴",
  "double bass": "低音提琴",
  贝斯: "低音提琴",
  bass: "低音提琴",

  // 木管
  长笛: "长笛",
  flute: "长笛",
  双簧管: "双簧管",
  oboe: "双簧管",
  欧宝: "双簧管",
  单簧管: "单簧管",
  黑管: "单簧管",
  clarinet: "单簧管",
  大管: "大管",
  巴松: "大管",
  bassoon: "大管",

  // 铜管
  圆号: "圆号",
  horn: "圆号",
  小号: "小号",
  trumpet: "小号",
  长号: "长号",
  trombone: "长号",
  大号: "大号",
  tuba: "大号",

  // 其他
  打击乐: "打击乐",
  打击: "打击乐",
  percussion: "打击乐",
  键盘: "键盘",
  钢琴: "键盘",
  keyboard: "键盘",
  竖琴: "竖琴",
  harp: "竖琴",
} as const;

/**
 * 将输入的声部名称解析为规范中文名
 * 如果匹配到别名则返回规范名，否则返回原输入（首字母大写化）
 */
export function resolveInstrumentName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  // 精确匹配（不区分大小写）
  const lower = trimmed.toLowerCase();
  for (const [alias, canonical] of Object.entries(INSTRUMENT_ALIAS_MAP)) {
    if (alias.toLowerCase() === lower) {
      return canonical;
    }
  }

  // 未匹配到别名，返回原值
  return trimmed;
}

/**
 * `profiles.instrument` 的合法值：16 个乐器 + 「其他」。
 *
 * 注意**不含「总谱」** —— 它是 `sheet_music_parts.section` 的特殊值，
 * 不是一个人可以属于的声部。与 DB 触发器 `validate_profile_instrument` 同一条判据。
 */
const PROFILE_INSTRUMENTS = new Set<string>([...INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP]);

/**
 * 把任意输入归一成 `profiles.instrument` 的合法值；无法归一返回 null。
 *
 * 用在「Excel 导入 → member_info → profiles」这条链上：`member_info.instrument_name`
 * 最终会被 `sync-profiles` / 审批预填写进 `profiles.instrument`，而 DB 已经开了严格校验，
 * 所以必须在源头归一，否则导入时看着成功、同步时才被触发器拒掉。
 */
export function normalizeProfileInstrument(input: string): string | null {
  const resolved = resolveInstrumentName(input);
  return PROFILE_INSTRUMENTS.has(resolved) ? resolved : null;
}
