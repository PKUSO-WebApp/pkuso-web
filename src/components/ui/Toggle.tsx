"use client";

type ToggleProps<T extends string> = {
  options: readonly T[] | T[];
  value: T;
  onChange: (value: T) => void;
  getLabel?: (option: T) => string;
  /** 处理中锁定切换，避免异步失败落到已卸载的页面区块。 */
  disabled?: boolean;
};

export function Toggle<T extends string>({
  options,
  value,
  onChange,
  getLabel,
  disabled = false,
}: ToggleProps<T>) {
  return (
    <div className="inline-flex w-fit rounded-full bg-muted p-1 text-xs">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={`min-w-[64px] rounded-full px-3 py-1 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-text-muted hover:text-text"
            }`}
          >
            {getLabel ? getLabel(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}
