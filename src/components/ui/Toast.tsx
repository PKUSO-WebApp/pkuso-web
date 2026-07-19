"use client";

import React, { createContext, useContext, useCallback, useState } from "react";

type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastFn = (message: string, type?: ToastType) => void;

const ToastCtx = createContext<ToastFn>(() => {});

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`animate-[fadeIn_0.2s_ease-out] rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${
              t.type === "success"
                ? "bg-success-bg text-success"
                : t.type === "error"
                  ? "bg-danger-bg text-danger"
                  : "bg-muted text-text"
            }`}
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastFn {
  return useContext(ToastCtx);
}
