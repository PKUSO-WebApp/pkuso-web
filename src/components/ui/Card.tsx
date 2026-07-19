import React from "react";

type CardProps = {
  children: React.ReactNode;
  className?: string;
  /** 使卡片可点击 */
  onClick?: () => void;
};

export function Card({ children, className = "", onClick }: CardProps) {
  const base =
    "rounded-2xl border border-zinc-100 bg-zinc-50/70 p-3 shadow-[0_1px_4px_rgba(15,23,42,0.06)]";
  const interactive = onClick ? "cursor-pointer transition hover:border-zinc-200" : "";

  const Component = onClick ? "button" : "div";

  return React.createElement(
    Component,
    {
      className: `${base} ${interactive} ${className}`.trim(),
      ...(onClick ? { onClick, type: "button" as const } : {}),
    },
    children,
  );
}
