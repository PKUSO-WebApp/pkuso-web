"use client";

import React from "react";

interface AdminPageHeaderState {
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
  resetHeader: () => void;
}

const AdminPageHeaderContext = React.createContext<AdminPageHeaderContextValue | null>(null);

export function useAdminPageHeader() {
  const ctx = React.useContext(AdminPageHeaderContext);
  if (!ctx) throw new Error("useAdminPageHeader must be used within AdminPageHeaderProvider");
  return ctx;
}

export function AdminPageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AdminPageHeaderState>({
    title: "",
    headerLeft: null,
    headerRight: null,
    onBack: undefined,
    headerLoading: false,
    hideBackButton: false,
  });

  const setTitle = React.useCallback((title: string) => {
    setState((prev) => ({ ...prev, title, hideBackButton: false }));
  }, []);

  const setHeaderLeft = React.useCallback((node: React.ReactNode) => {
    setState((prev) => ({ ...prev, headerLeft: node }));
  }, []);

  const setHeaderRight = React.useCallback((node: React.ReactNode) => {
    setState((prev) => ({ ...prev, headerRight: node }));
  }, []);

  const setOnBack = React.useCallback((handler: () => void) => {
    setState((prev) => ({ ...prev, onBack: handler }));
  }, []);

  const setHeaderLoading = React.useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, headerLoading: loading }));
  }, []);

  const setHideBackButton = React.useCallback((hide: boolean) => {
    setState((prev) => ({ ...prev, hideBackButton: hide }));
  }, []);

  const resetHeader = React.useCallback(() => {
    setState({
      title: "",
      headerLeft: null,
      headerRight: null,
      onBack: undefined,
      headerLoading: false,
      hideBackButton: false,
    });
  }, []);

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
        resetHeader,
      }}
    >
      {children}
    </AdminPageHeaderContext.Provider>
  );
}
