"use client";

import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from "react";
import { X } from "lucide-react";
import { SECTION_GROUPS, ALL_SECTIONS } from "@/constants/instruments";

interface SectionSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SectionSelect({
  value,
  onChange,
  placeholder = "输入声部名或声部组名",
  disabled = false,
  className = "",
}: SectionSelectProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedSet = new Set(value);

  const getSuggestions = (query: string) => {
    const suggestions: { label: string; isGroup: boolean; sections?: string[] }[] = [];

    // 匹配声部组
    for (const [groupName, sections] of Object.entries(SECTION_GROUPS)) {
      if (groupName.includes(query) || sections.some((s) => s.includes(query))) {
        suggestions.push({ label: groupName, isGroup: true, sections: [...sections] });
      }
    }

    // 匹配具体声部（排除已在组中匹配的）
    const matchedSections = new Set(suggestions.flatMap((s) => s.sections || []));
    for (const section of ALL_SECTIONS) {
      if (!matchedSections.has(section) && section.includes(query)) {
        suggestions.push({ label: section, isGroup: false });
      }
    }

    // 已选的不显示
    return suggestions.filter((s) => !selectedSet.has(s.label));
  };

  const suggestions = getSuggestions(inputValue);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (focusedIndex >= 0) {
          selectSuggestion(suggestions[focusedIndex]);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
      case "Backspace":
        if (inputValue === "" && value.length > 0) {
          const newValue = value.slice(0, -1);
          onChange(newValue);
        }
        break;
    }
  };

  const selectSuggestion = (suggestion: {
    label: string;
    isGroup: boolean;
    sections?: string[];
  }) => {
    if (suggestion.isGroup && suggestion.sections) {
      const newValue = [...value, ...suggestion.sections.filter((s) => !selectedSet.has(s))];
      onChange(newValue);
    } else if (!suggestion.isGroup) {
      onChange([...value, suggestion.label]);
    }
    setInputValue("");
    setFocusedIndex(-1);
    inputRef.current?.focus();
  };

  const removeSection = (section: string) => {
    onChange(value.filter((s) => s !== section));
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setIsOpen(true);
    setFocusedIndex(-1);
  };

  const handleFocus = () => {
    if (!disabled) setIsOpen(true);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={`relative w-full ${className}`}>
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-muted px-3 py-2 min-h-[42px] text-xs focus-within:border-text-muted transition-colors"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((section) => (
          <span
            key={section}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium"
          >
            {section}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeSection(section);
              }}
              className="p-0.5 hover:bg-primary/20 rounded-full transition-colors"
              aria-label={`移除 ${section}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-text placeholder:text-text-muted"
          style={{ minWidth: "120px" }}
          aria-autocomplete="list"
          aria-controls="section-suggestions"
        />
      </div>

      {isOpen && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          id="section-suggestions"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-border bg-card shadow-lg"
          role="listbox"
        >
          {Object.entries(
            suggestions.reduce(
              (acc, s) => {
                const key = s.isGroup ? `组: ${s.label}` : "声部";
                if (!acc[key]) acc[key] = [];
                acc[key].push(s);
                return acc;
              },
              {} as Record<string, typeof suggestions>,
            ),
          ).map(([groupName, items]) => (
            <div key={groupName} className="border-t border-border first:border-t-0">
              <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider bg-muted/50">
                {groupName}
              </div>
              {items.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => selectSuggestion(suggestion)}
                  onMouseEnter={() => setFocusedIndex(suggestions.indexOf(suggestion))}
                  className={`w-full px-3 py-2 text-left text-xs text-text hover:bg-muted transition-colors ${
                    focusedIndex === suggestions.indexOf(suggestion) ? "bg-muted" : ""
                  }`}
                  role="option"
                  aria-selected={focusedIndex === suggestions.indexOf(suggestion)}
                >
                  <span className="flex items-center gap-2">
                    {suggestion.isGroup && <span className="text-[10px] text-text-muted">组</span>}
                    {suggestion.label}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {isOpen && suggestions.length === 0 && inputValue && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card px-3 py-4 text-center text-xs text-text-muted">
          未找到匹配的声部或声部组
        </div>
      )}
    </div>
  );
}
