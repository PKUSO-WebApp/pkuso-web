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
export function renderWithProviders(
  ui: React.ReactElement,
  options?: RenderOptions,
  // 默认常量够用：这些用例只渲染一个页面、不做换页；顶栏状态的换页作废由
  // admin/layout.test.tsx 走真实 AdminLayout 覆盖。要模拟换页的用例再传新值。
  routeKey = "/admin",
) {
  return render(
    <AdminPageHeaderProvider routeKey={routeKey}>{ui}</AdminPageHeaderProvider>,
    options,
  );
}
