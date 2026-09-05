"use client";

import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { useThemeContext } from "@/context/theme-context";
import { THEME_OPTIONS, themeLabel } from "@/lib/theme";

export function ThemeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { preference, mode, setPreference } = useThemeContext();
  return (
    <Modal open={open} onClose={onClose} title="外观" position="bottom">
      <div className="mt-4 space-y-3">
        <Toggle
          options={THEME_OPTIONS}
          value={preference}
          onChange={setPreference}
          getLabel={themeLabel}
        />
        <p className="text-xs leading-relaxed text-text-muted">
          当前为「{mode === "dark" ? "暗色" : "亮色"}」模式
          {preference === "system" && "（跟随系统：随设备系统外观自动切换）"}
        </p>
      </div>
    </Modal>
  );
}
