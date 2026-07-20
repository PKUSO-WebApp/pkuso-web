"use client";

import React from "react";

type Props = {
  selectedDate: string;
  onDateChange: (date: string) => void;
};

export function DateSelector({ selectedDate, onDateChange }: Props) {
  // 使用 useMemo 缓存日期列表，避免每次渲染重新计算
  const dates = React.useMemo(() => {
    const dateList = [];
    const today = new Date();
    const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

    for (let i = 0; i < 8; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      // 使用本地日期格式，避免时区问题
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;

      const dayOfMonth = date.getDate();
      const dayOfWeekStr = weekDays[date.getDay()];

      let label = "";
      if (i === 0) {
        label = "今天";
      } else if (i === 1) {
        label = "明天";
      } else {
        label = `${dayOfMonth}日`;
      }

      dateList.push({ date: dateStr, label, dayOfWeek: dayOfWeekStr });
    }

    return dateList;
  }, []);

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {dates.map((item) => {
        const isSelected = item.date === selectedDate;
        return (
          <button
            key={item.date}
            onClick={() => onDateChange(item.date)}
            className={`flex-shrink-0 flex flex-col items-center rounded-xl px-3 py-2 transition-all duration-200 ${
              isSelected
                ? "bg-primary text-primary-foreground shadow-md"
                : "bg-card border border-border text-text hover:bg-muted"
            }`}
          >
            <span className="text-text-muted" style={{ fontSize: "var(--text-caption)" }}>
              {item.dayOfWeek}
            </span>
            <span className="text-sm font-medium">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
