import { createContext, useContext, useState, ReactNode } from "react";

type ViewMode = "admin" | "agent";

interface ViewModeContextValue {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isAgentView: boolean;
  isAdminView: boolean;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>("admin");

  return (
    <ViewModeContext.Provider
      value={{
        viewMode,
        setViewMode,
        isAgentView: viewMode === "agent",
        isAdminView: viewMode === "admin",
      }}
    >
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error("useViewMode must be used within ViewModeProvider");
  return ctx;
}
