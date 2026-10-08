"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import dynamic from "next/dynamic";

interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class GlobalErrorBoundary extends Component<
  { children: ReactNode },
  GlobalErrorBoundaryState
> {
  state: GlobalErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Global workspace render error:", error, errorInfo);
  }

  private resetWorkspaceStorage = () => {
    try {
      const genieKeys = Object.keys(localStorage).filter((key) =>
        key.startsWith("genie_")
      );
      genieKeys.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.error("Failed to clear Genie workspace storage:", error);
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex h-screen w-full flex-col items-center justify-center bg-slate-50 p-6 font-sans text-slate-800">
          <section className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-xl">
            <h1 className="mb-2 text-base font-bold text-rose-600">
              Workspace Render Exception
            </h1>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-xs text-rose-800">
              {this.state.error?.message || "Unknown client error"}
            </pre>
            <button
              type="button"
              onClick={this.resetWorkspaceStorage}
              className="mt-4 w-full rounded-xl bg-rose-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
            >
              Reset Genie Storage & Reload
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

const WorkspaceContainer = dynamic(
  () => import("@/components/genie/WorkspaceContainer"),
  { ssr: false }
);

export default function Page() {
  return (
    <GlobalErrorBoundary>
      <WorkspaceContainer />
    </GlobalErrorBoundary>
  );
}
