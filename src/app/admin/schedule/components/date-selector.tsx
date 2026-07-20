"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  selectedDate: string;
  onDateChange: (date: string) => void;
};

export function DateSelector({ selectedDate, onDateChange }: Props) {
  const [currentMonth, setCurrentMonth] = React.useState(() => {
    const date = new Date(selectedDate);
    return { year: date.getFullYear(), month: date.getMonth() };
  });

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const firstDay = new Date(currentMonth.year, currentMonth.month, 1);
  const lastDay = new Date(currentMonth.year, currentMonth.month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => {
      const newMonth = prev.month - 1;
      return newMonth < 0
        ? { year: prev.year - 1, month: 11 }
        : { year: prev.year, month: newMonth };
    });
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => {
      const newMonth = prev.month + 1;
      return newMonth > 11
        ? { year: prev.year + 1, month: 0 }
        : { year: prev.year, month: newMonth };
    });
  };

  const isToday = (dateStr: string) => dateStr === todayStr;

  return (
    <div className="bg-card rounded-xl border border-border p-3">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={handlePrevMonth}
          className="p-1 rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-5 w-5 text-text-muted" />
        </button>
        <span className="text-sm font-medium text-text">
          {currentMonth.year}年{currentMonth.month + 1}月
        </span>
        <button
          onClick={handleNextMonth}
          className="p-1 rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronRight className="h-5 w-5 text-text-muted" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((day) => (
          <div
            key={day}
            className="text-center text-text-muted"
            style={{ fontSize: "var(--text-caption)" }}
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-8" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = dateStr === selectedDate;
          const isPast = dateStr < todayStr;

          return (
            <button
              key={dateStr}
              onClick={() => !isPast && onDateChange(dateStr)}
              disabled={isPast}
              className={`h-8 rounded-lg text-sm font-medium transition-all ${
                isSelected
                  ? "bg-primary text-primary-foreground shadow-md"
                  : isToday(dateStr)
                    ? "bg-muted text-text"
                    : isPast
                      ? "text-text-muted cursor-not-allowed"
                      : "text-text hover:bg-muted"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
