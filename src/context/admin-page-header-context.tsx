"use client";

import React from "react";

interface AdminPageHeaderState {
  title: string;
  headerRight: React.ReactNode;
  onBack?: () => void;
}

interface AdminPageHeaderContextValue {
  title: string;
  headerRight: React.ReactNode;
  onBack?: () => void;
  setTitle: (title: string) => void;
  setHeaderRight: (node: React.ReactNode) => void;
  setOnBack: (handler: () => void) => void;
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
  });

  const setTitle = React.useCallback((title: string) => {
    setState((prev) => ({ ...prev, title }));
  }, []);

  const setHeaderRight = React.useCallback((node: React.ReactNode) => {
    setState((prev) => ({ ...prev, headerRight: node }));
  }, []);

  const setOnBack = React.useCallback((handler: () => void) => {
    setState((prev) => ({ ...prev, onBack: handler }));
  }, []);

  const resetHeader = React.useCallback(() => {
    setState({ title: "", headerRight: null, onBack: undefined });
  }, []);

  return (
    <AdminPageHeaderContext.Provider
      value={{
        title: state.title,
        headerRight: state.headerRight,
        onBack: state.onBack,
        setTitle,
        setHeaderRight,
        setOnBack,
        resetHeader,
      }}
    >
      {children}
    </AdminPageHeaderContext.Provider>
  );
}
