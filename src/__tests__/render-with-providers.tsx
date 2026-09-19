import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { AdminPageHeaderProvider } from "@/context/admin-page-header-context";

/**
 * 统一测试包裹器：自动提供 AdminPageHeaderProvider 等全局 Context。
 *
 * 用法：
 *   import { renderWithProviders } from "@/__tests__/render-with-providers";
 *   renderWithProviders(<MyComponent />);
 */
export function renderWithProviders(ui: React.ReactElement, options?: RenderOptions) {
  return render(<AdminPageHeaderProvider>{ui}</AdminPageHeaderProvider>, options);
}
