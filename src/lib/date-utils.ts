/**
 * 将 Date 对象格式化为本地时间的 ISO 字符串（不含时区偏移）
 * 避免 toISOString() 将本地时间转为 UTC 时间导致的时区偏移问题
 *
 * @param date - Date 对象
 * @returns 格式为 "YYYY-MM-DDTHH:mm:ss" 的字符串
 */
export function formatLocalISO(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error("Invalid Date object");
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * 获取本地日期字符串（YYYY-MM-DD），避免时区转换问题
 *
 * @param date - Date 对象，默认为当前日期
 * @returns 格式为 "YYYY-MM-DD" 的字符串
 */
export function getLocalDateString(date: Date = new Date()): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error("Invalid Date object");
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 将 ISO 字符串解析为本地时间的 Date 对象
 * 直接使用字符串中的年月日时分秒，不进行时区转换
 *
 * @param dateStr - ISO 格式字符串（如 "YYYY-MM-DDTHH:mm:ss"）
 * @returns Date 对象（本地时间）
 */
export function parseLocalISO(dateStr: string): Date {
  const parts = dateStr.split("T");
  const dateParts = parts[0]?.split("-") ?? [];
  const timeParts = parts[1]?.split(":") ?? [];

  const year = parseInt(dateParts[0], 10) || 0;
  const month = (parseInt(dateParts[1], 10) || 1) - 1;
  const day = parseInt(dateParts[2], 10) || 1;
  const hours = parseInt(timeParts[0], 10) || 0;
  const minutes = parseInt(timeParts[1], 10) || 0;
  const seconds = parseInt(timeParts[2], 10) || 0;

  return new Date(year, month, day, hours, minutes, seconds);
}

/**
 * 格式化时间为 HH:mm 格式
 * 使用 parseLocalISO 解析，避免时区问题
 *
 * @param timeStr - ISO 格式字符串（如 "YYYY-MM-DDTHH:mm:ss"）或 null
 * @returns 格式为 "HH:mm" 的字符串，无效时返回 "--:--"
 */
export function formatTime(timeStr: string | null): string {
  if (!timeStr) return "--:--";
  const date = parseLocalISO(timeStr);
  if (isNaN(date.getTime())) return "--:--";
  return date.toTimeString().slice(0, 5);
}

/**
 * 格式化日期为 "月日 星期几" 格式
 * 使用 parseLocalISO 解析，避免时区问题
 *
 * @param dateStr - ISO 格式字符串（如 "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:mm:ss"）
 * @returns 格式为 "X月X日 星期X" 的字符串
 */
export function formatDisplayDate(dateStr: string): string {
  const date = parseLocalISO(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dayOfWeek = weekDays[date.getDay()];
  return `${month}月${day}日 ${dayOfWeek}`;
}

/**
 * 格式化日期时间为 "X月X日 周X HH:mm" 格式（用于公告结束时间，含时分）
 * 使用 parseLocalISO 解析，避免时区问题
 *
 * @param dateStr - ISO 格式字符串（如 "YYYY-MM-DDTHH:mm:ss"）
 * @returns 格式为 "X月X日 周X HH:mm" 的字符串
 */
export function formatDisplayDateTime(dateStr: string): string {
  const date = parseLocalISO(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dayOfWeek = weekDays[date.getDay()];
  const time = formatTime(dateStr);
  return `${month}月${day}日 ${dayOfWeek} ${time}`;
}

/**
 * 格式化日期时间为 "MM-DD HH:mm" 格式
 * 使用 parseLocalISO 解析，避免时区问题
 *
 * @param dateStr - ISO 格式字符串（如 "YYYY-MM-DDTHH:mm:ss"）或 null
 * @returns 格式为 "MM-DD HH:mm" 的字符串，无效时返回 "—"
 */
export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = parseLocalISO(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * 格式化排练时间段为 "X月X日 星期X HH:mm - HH:mm" 格式
 * 供 member/admin 两端共用（原位于 member 端私有 utils，迁移至此消除跨端 import）
 *
 * @param startValue - 开始时间 ISO 字符串（如 "YYYY-MM-DDTHH:mm:ss"）
 * @param endValue - 结束时间 ISO 字符串或 null
 * @returns 格式化后的时间段文案；结束时间为空时仅返回开始时间
 */
export function formatRehearsalRange(startValue: string, endValue: string | null) {
  const start = parseLocalISO(startValue);
  if (Number.isNaN(start.getTime())) return startValue;
  const end = endValue ? parseLocalISO(endValue) : null;

  const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });
  const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const weekday = weekdayFormatter.format(start);
  const month = start.getMonth() + 1;
  const day = start.getDate();
  const startTime = timeFormatter.format(start);
  const datePart = `${month}月${day}日 ${weekday}`;

  if (!end || Number.isNaN(end.getTime())) return `${datePart} ${startTime}`;
  const endTimeFormatted = timeFormatter.format(end);
  return `${datePart} ${startTime} - ${endTimeFormatted}`;
}

/**
 * 判断排练是否已过期（结束时间（或开始时间）+ 12 小时后仍早于当前时间）
 * 供 member/admin 两端共用（原位于 member 端私有 utils，迁移至此消除跨端 import）
 *
 * @param startTime - 开始时间 ISO 字符串
 * @param endTime - 结束时间 ISO 字符串或 null
 * @returns 是否已过期；时间解析失败时返回 false
 */
export function isRehearsalExpired(startTime: string, endTime: string | null) {
  const base = endTime ? parseLocalISO(endTime) : parseLocalISO(startTime);
  if (Number.isNaN(base.getTime())) return false;
  return Date.now() > base.getTime() + 12 * 60 * 60 * 1000;
}

/**
 * 将 UTC 时间字符串转换为中国时区显示
 * 检测以下 UTC 格式：
 * - 以 Z 结尾：如 "2024-07-31T14:30:00Z"
 * - 以 +00 结尾：如 "2026-07-31 08:19:11.1906+00"
 * - 带时区偏移：如 "2024-07-31T14:30:00+00:00"
 * 如果没有时区后缀，则直接按本地时间解析显示
 *
 * @param dateStr - ISO 格式字符串或 null
 * @returns 格式为 "MM/DD HH:mm" 的字符串，无效时返回 "—"
 */
export function formatDateTimeInChina(dateStr: string | null): string {
  if (!dateStr) return "—";

  // 检测是否为 UTC 时间（Z 后缀 或 +00:00 偏移）
  const isUTC =
    dateStr.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateStr) || /\+00(?::\d{2})?$/.test(dateStr);

  if (isUTC) {
    // UTC 时间，转换为中国时区
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    }).format(date);
  } else {
    // 本地时间（无时区后缀），直接解析
    const date = parseLocalISO(dateStr);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
}
