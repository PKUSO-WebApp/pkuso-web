import React from "react";

type CardProps = {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

export function Card({ children, className = "", onClick }: CardProps) {
  const base = "rounded-2xl border border-border bg-card p-3";
  const shadow = "shadow-[var(--shadow-card)]";
  const interactive = onClick ? "cursor-pointer transition hover:border-text-muted" : "";

  const Component = onClick ? "button" : "div";

  return React.createElement(
    Component,
    {
      className: `${base} ${shadow} ${interactive} ${className}`.trim(),
      ...(onClick ? { onClick, type: "button" as const } : {}),
    },
    children,
  );
}
