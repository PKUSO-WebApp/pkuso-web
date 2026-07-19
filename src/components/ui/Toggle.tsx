"use client";

type ToggleProps<T extends string> = {
  options: readonly T[] | T[];
  value: T;
  onChange: (value: T) => void;
  /** 选项的显示标签,默认用选项值本身 */
  getLabel?: (option: T) => string;
};

export function Toggle<T extends string>({ options, value, onChange, getLabel }: ToggleProps<T>) {
  return (
    <div className="inline-flex rounded-full bg-zinc-100 p-1 text-xs">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`min-w-[64px] rounded-full px-3 py-1 text-center transition-colors ${
              active ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {getLabel ? getLabel(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}
