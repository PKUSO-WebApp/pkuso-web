"use client";

import React from "react";

interface AdminPageHeaderState {
  title: string;
  headerRight: React.ReactNode;
  onBack?: () => void;
  headerLoading: boolean;
  hideBackButton: boolean;
}

interface AdminPageHeaderContextValue {
  title: string;
  headerRight: React.ReactNode;
  onBack?: () => void;
  headerLoading: boolean;
  hideBackButton: boolean;
  setTitle: (title: string) => void;
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
    headerRight: null,
    onBack: undefined,
    headerLoading: false,
    hideBackButton: false,
  });

  const setTitle = React.useCallback((title: string) => {
    setState((prev) => ({ ...prev, title, hideBackButton: false }));
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
        headerRight: state.headerRight,
        onBack: state.onBack,
        headerLoading: state.headerLoading,
        hideBackButton: state.hideBackButton,
        setTitle,
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
