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
