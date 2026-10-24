import React from "react";

type ButtonVariant = "primary" | "secondary";

const BASE = "rounded-full px-4 py-2 text-xs font-medium disabled:opacity-60";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-surface text-text-muted hover:bg-muted",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

/** 弹层底部操作按钮（取消 / 保存）；列表内的小按钮仍按各页自己的尺寸写。 */
export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <button {...props} className={`${BASE} ${VARIANT[variant]} ${className}`.trim()} />;
}
