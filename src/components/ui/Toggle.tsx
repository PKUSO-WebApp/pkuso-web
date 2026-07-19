"use client";

type ToggleProps<T extends string> = {
  options: readonly T[] | T[];
  value: T;
  onChange: (value: T) => void;
  getLabel?: (option: T) => string;
};

export function Toggle<T extends string>({ options, value, onChange, getLabel }: ToggleProps<T>) {
  return (
    <div className="inline-flex rounded-full bg-muted p-1 text-xs">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`min-w-[64px] rounded-full px-3 py-1 text-center transition-colors ${
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
