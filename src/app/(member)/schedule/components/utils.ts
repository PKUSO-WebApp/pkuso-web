import { parseLocalISO } from "@/lib/date-utils";

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

export function isRehearsalExpired(startTime: string, endTime: string | null) {
  const base = endTime ? parseLocalISO(endTime) : parseLocalISO(startTime);
  if (Number.isNaN(base.getTime())) return false;
  return Date.now() > base.getTime() + 12 * 60 * 60 * 1000;
}
