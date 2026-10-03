"use client";

import React from "react";

interface AdminPageHeaderState {
  /**
   * 这份状态属于哪个 `routeKey`。setter 拿它丢弃**陈旧页面**的写入 ——
   * 上一页卸载后仍在飞的回调（谱务详情页 fetch 回来才 `setTitle(曲名)`、
   * 删完文件 refetch 再写一次）手里握的是旧路由下创建的 setter，
   * 只靠「换页清一次」挡不住它，它会在清空之后把上一页的值写回来。
   */
  routeKey: string;
  title: string;
  /**
   * 顶栏**左侧**槽。设置后**取代**默认的「返回」按钮（不是并排）。
   * 只有一个真实用例：谱务列表页给 `score_manager` 放退出登录——
   * 那一页的「返回」走默认的 `router.push("/admin")`，而 `/admin` 对他越界
   * （`lib/access.ts`），是个按了原地打转的死按钮。
   * 不设 = 行为与引入本槽之前逐字一致。
   */
  headerLeft: React.ReactNode;
  headerRight: React.ReactNode;
  onBack?: () => void;
  headerLoading: boolean;
  hideBackButton: boolean;
}

interface AdminPageHeaderContextValue {
  title: string;
  headerLeft: React.ReactNode;
  headerRight: React.ReactNode;
  onBack?: () => void;
  headerLoading: boolean;
  hideBackButton: boolean;
  setTitle: (title: string) => void;
  setHeaderLeft: (node: React.ReactNode) => void;
  setHeaderRight: (node: React.ReactNode) => void;
  setOnBack: (handler: () => void) => void;
  setHeaderLoading: (loading: boolean) => void;
  setHideBackButton: (hide: boolean) => void;
}

/** 空顶栏：`routeKey` 一变就整体回到这里 */
function emptyHeader(routeKey: string): AdminPageHeaderState {
  return {
    routeKey,
    title: "",
    headerLeft: null,
    headerRight: null,
    onBack: undefined,
    headerLoading: false,
    hideBackButton: false,
  };
}

const AdminPageHeaderContext = React.createContext<AdminPageHeaderContextValue | null>(null);

export function useAdminPageHeader() {
  const ctx = React.useContext(AdminPageHeaderContext);
  if (!ctx) throw new Error("useAdminPageHeader must be used within AdminPageHeaderProvider");
  return ctx;
}

export function AdminPageHeaderProvider({
  routeKey,
  children,
}: {
  /**
   * 顶栏状态的**生命周期键**：换一个值，上一页留下的槽位（title / headerLeft /
   * headerRight / onBack / …）整体作废。
   *
   * 顶栏状态住在 `admin/layout.tsx` 的 Provider 里，而 layout **跨路由不重挂** ——
   * 没有这个键的话，就是「谁最后 `setHeaderRight`，谁替后面所有页面占着右槽」：
   * 逛一次排练页（右槽 =「发布新日程」），之后考勤 / 审批 / 请假 / 公告… 右上角
   * 全顶着它；只有自己设了右槽的页面（谱务）看不出来。
   *
   * 键由挂载方给（layout 传 `usePathname()`），**不在这里读路由**：这个 Context 因此
   * 不依赖 router 上下文，页面级测试挂 Provider 时不必造路由桩。
   */
  routeKey: string;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<AdminPageHeaderState>(() => emptyHeader(routeKey));

  // ⚠️ 必须在**渲染期**清，不能挪进 effect：effect 是子先父后，新页面自己的 effect
  // 会先把槽位设好，父组件再去清就成了清掉新页面刚设的（症状是顶栏空白）。
  if (state.routeKey !== routeKey) {
    setState(emptyHeader(routeKey));
  }

  /**
   * 所有 setter 的唯一出口。**写入必须来自当前路由**：`prev.routeKey !== routeKey`
   * 说明这份 state 已经属于新页面了，而调用方手里的是旧路由下创建的 setter
   * （典型：上一页卸载后仍在飞的回调）⇒ 直接丢弃，返回 `prev` 让 React 空转。
   * 只清一次挡不住这种写入，见上面 state.routeKey 的说明。
   */
  const update = React.useCallback(
    (patch: Partial<AdminPageHeaderState>) => {
      setState((prev) => (prev.routeKey === routeKey ? { ...prev, ...patch } : prev));
    },
    [routeKey],
  );

  const setTitle = React.useCallback(
    (title: string) => update({ title, hideBackButton: false }),
    [update],
  );

  const setHeaderLeft = React.useCallback(
    (node: React.ReactNode) => update({ headerLeft: node }),
    [update],
  );

  const setHeaderRight = React.useCallback(
    (node: React.ReactNode) => update({ headerRight: node }),
    [update],
  );

  const setOnBack = React.useCallback(
    (handler: () => void) => update({ onBack: handler }),
    [update],
  );

  const setHeaderLoading = React.useCallback(
    (loading: boolean) => update({ headerLoading: loading }),
    [update],
  );

  const setHideBackButton = React.useCallback(
    (hide: boolean) => update({ hideBackButton: hide }),
    [update],
  );

  return (
    <AdminPageHeaderContext.Provider
      value={{
        title: state.title,
        headerLeft: state.headerLeft,
        headerRight: state.headerRight,
        onBack: state.onBack,
        headerLoading: state.headerLoading,
        hideBackButton: state.hideBackButton,
        setTitle,
        setHeaderLeft,
        setHeaderRight,
        setOnBack,
        setHeaderLoading,
        setHideBackButton,
      }}
    >
      {children}
    </AdminPageHeaderContext.Provider>
  );
}
