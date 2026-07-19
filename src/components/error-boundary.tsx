"use client";

import React from "react";

type Props = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-screen items-center justify-center px-4">
            <div className="text-center">
              <h1 className="text-lg font-semibold text-text">页面出错了</h1>
              <p className="mt-2 max-w-xs text-sm text-text-muted">
                {this.state.error?.message || "未知错误"}
              </p>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                重试
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
