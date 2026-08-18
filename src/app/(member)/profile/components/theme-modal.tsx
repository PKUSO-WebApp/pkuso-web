"use client";

import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { useThemeContext } from "@/context/theme-context";
import { THEME_OPTIONS, themeLabel } from "@/lib/theme";

// 外观弹窗（Issue #203）：亮色 / 暗色 / 跟随系统 三态主题选择。
// 复用 Toggle 分段控件（与编辑弹窗隐私开关同款）；选中态即用户偏好，
// 切换即时生效（html data-theme）并持久化（localStorage，见 src/lib/theme.ts）。
// 状态来自全局 ThemeProvider（对抗返工 Issue #203）：弹窗只读共享状态，
// matchMedia/storage 监听由根 layout 的 provider 统一持有，全站实时跟随系统。
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
