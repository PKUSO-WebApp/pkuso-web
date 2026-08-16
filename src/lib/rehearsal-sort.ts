import { parseLocalISO } from "@/lib/date-utils";
import type { RehearsalRow } from "@/types/database";

/** 默认排练时长（end_time 缺失时按开始时间 + 3 小时计，与签到/卡片逻辑一致） */
const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

/**
 * 已更新判定：编辑过（updated_at > created_at）
 *
 * 两个字段均为 ISO 时间字符串，用 Date.parse 统一转为绝对时刻比较，
 * 可容忍数据库返回的格式差异（timestamptz 可能带 +00 后缀/毫秒/微秒；
 * updated_at 由 DB 触发器以 now() 写入，与 created_at 同源时钟）。
 * 任一时段缺失（如历史数据缺 created_at）视为未更新。
 */
export function isRehearsalUpdated(item: RehearsalRow): boolean {
  if (!item.updated_at || !item.created_at) return false;
  const updatedMs = Date.parse(item.updated_at);
  const createdMs = Date.parse(item.created_at);
  if (Number.isNaN(updatedMs) || Number.isNaN(createdMs)) return false;
  return updatedMs > createdMs;
}

/**
 * 已结束判定：now >= end（恰好等于 end 的时刻也算已结束，与"持续到排练结束"一致）
 *
 * 复用 parseRehearsalTimes 的解析逻辑（end_time 缺失按 start + 3 小时计）；
 * 无有效 start_time（无法解析）时视为未结束。
 */
export function isRehearsalEnded(item: RehearsalRow, now: Date): boolean {
  const times = parseRehearsalTimes(item);
  if (!times) return false;
  return now.getTime() >= times.endMs;
}

/**
 * 解析排练的开始/结束时刻（本地时区）
 *
 * start_time 缺失或无法解析（parseLocalISO 退化到 1900 年附近）时返回 null；
 * end_time 缺失或无法解析时按 start + 3 小时计。
 */
function parseRehearsalTimes(item: RehearsalRow): { startMs: number; endMs: number } | null {
  if (!item.start_time) return null;
  const start = parseLocalISO(item.start_time);
  // parseLocalISO 对无法解析的字符串会退化为 1900 年附近，视为无有效时间
  if (start.getFullYear() < 2000) return null;
  const startMs = start.getTime();
  let endMs = startMs + DEFAULT_DURATION_MS;
  if (item.end_time) {
    const end = parseLocalISO(item.end_time);
    if (end.getFullYear() >= 2000) endMs = end.getTime();
  }
  return { startMs, endMs };
}

/**
 * 用户端排练排序（对齐 Issue #140）
 *
 * 输入为已过滤窗口内的排练（窗口过滤仍由 isRehearsalWithinNextWeek 承担）。
 * 三态以 start/end 为界（不引入签到 30 分钟窗口）：
 * - upcoming（进行中 now ∈ [start, end] + 未开始 now < start）：进行中恒在未开始前，
 *   组内按 |start - now| 近 → 远；
 * - ended（now > end）：按 |end - now| 近 → 远（最近结束在前），整组排在底部；
 * - 更新置顶：upcoming 组内，已更新（updated_at > created_at）且非第一位的排练提到
 *   第一位之后，保持其相对时间顺序（多个已更新项内部仍按时间近 → 远）；
 *   首位本身已更新时其余已更新项同样置顶；ended 组不受更新影响；
 * - 无有效 start_time 的排练排在最后，保持原相对顺序。
 *
 * 不修改原数组。
 */
export function sortRehearsalsForMember(items: RehearsalRow[], now: Date): RehearsalRow[] {
  const nowMs = now.getTime();

  const upcoming: RehearsalRow[] = [];
  const ended: RehearsalRow[] = [];
  const noTime: RehearsalRow[] = [];
  const timeByItem = new Map<RehearsalRow, { startMs: number; endMs: number }>();

  for (const item of items) {
    const times = parseRehearsalTimes(item);
    if (!times) {
      // 无有效 start_time：排最后，保持原相对顺序
      noTime.push(item);
      continue;
    }
    timeByItem.set(item, times);
    if (nowMs > times.endMs) ended.push(item);
    else upcoming.push(item);
  }

  // upcoming：先按是否进行中分组（进行中恒在前），组内按 |start - now| 近 → 远。
  // 注意不能用 |start - now| 跨组混排：未开始距 start 很近时会被排到进行中前面（Issue #140 返工）
  upcoming.sort((a, b) => {
    const ta = timeByItem.get(a)!;
    const tb = timeByItem.get(b)!;
    const aInProgress = nowMs >= ta.startMs ? 0 : 1;
    const bInProgress = nowMs >= tb.startMs ? 0 : 1;
    if (aInProgress !== bInProgress) return aInProgress - bInProgress;
    return Math.abs(ta.startMs - nowMs) - Math.abs(tb.startMs - nowMs);
  });

  // 更新置顶：首位保持，其余已更新的提到第一位之后（保持相对时间顺序），未更新的跟随其后。
  // 首位本身已更新时同样执行（首位不动，其余已更新项照样置顶，Issue #140 返工）
  if (upcoming.length > 1) {
    const [first, ...rest] = upcoming;
    const updatedRest = rest.filter(isRehearsalUpdated);
    if (updatedRest.length > 0) {
      const others = rest.filter((item) => !isRehearsalUpdated(item));
      upcoming.length = 0;
      upcoming.push(first, ...updatedRest, ...others);
    }
  }

  // ended：|end - now| 近 → 远（最近结束在前）
  ended.sort((a, b) => {
    const ta = timeByItem.get(a)!;
    const tb = timeByItem.get(b)!;
    return Math.abs(ta.endMs - nowMs) - Math.abs(tb.endMs - nowMs);
  });

  return [...upcoming, ...ended, ...noTime];
}

/**
 * 历史合排列表（Issue #154）：筛选 type=full 且已结束的排练，按结束时刻近 → 远排序
 *
 * - 已结束判定与 isRehearsalEnded 一致（now >= end，恰在结束时刻也算已结束；
 *   end_time 缺失按 start + 3 小时计），与卡片状态判定口径统一
 * - 不限一周窗口：完整历史，不应用 isRehearsalWithinNextWeek 的窗口过滤
 * - 分排（type=section）、未结束、无有效 start_time（无法解析结束时刻）的排练不出现
 * - 不修改原数组；相同结束时刻保持原相对顺序（Array.prototype.sort 稳定）
 */
export function sortEndedFullRehearsals(items: RehearsalRow[], now: Date): RehearsalRow[] {
  const nowMs = now.getTime();
  const ended: { item: RehearsalRow; endMs: number }[] = [];
  for (const item of items) {
    if (item.type !== "full") continue;
    const times = parseRehearsalTimes(item);
    if (!times) continue;
    if (nowMs >= times.endMs) ended.push({ item, endMs: times.endMs });
  }
  // 近 → 远：结束时刻晚的在前（最近结束在前）
  ended.sort((a, b) => b.endMs - a.endMs);
  return ended.map((e) => e.item);
}
