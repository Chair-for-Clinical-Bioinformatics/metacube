// Runtime theme state: the active light/dark mode (seeded from the OS setting,
// then remembered) and the scheme chosen by the loaded dataset config. Components
// read the resolved palette via useTheme(); the 3D <Canvas> needs the context
// bridged across its reconciler boundary — see ThemeContext / re-provide pattern.

import {
  createContext, useContext, useState, useEffect, useLayoutEffect, useMemo, useCallback,
  type ReactNode,
} from "react";
import {
  type ColourScheme, type ThemeMode, type Theme, resolveTheme, DEFAULT_SCHEME,
  themeToCssVars,
} from "./theme";
import { setActiveTheme } from "./colors";

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  scheme: ColourScheme;
  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "metacube-theme-mode";

function initialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage unavailable (e.g. file:// export) — fall through to OS pref */
  }
  if (typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function ThemeProvider(
  { scheme = DEFAULT_SCHEME, forcedMode, children }: {
    scheme?: ColourScheme;
    /** Start in this mode regardless of the remembered/OS choice (e.g. ?theme=dark). */
    forcedMode?: ThemeMode;
    children: ReactNode;
  },
) {
  const [mode, setModeState] = useState<ThemeMode>(() => forcedMode ?? initialMode());

  // Persist the user's explicit choice (a forced start mode is not a choice).
  useEffect(() => {
    if (forcedMode && mode === forcedMode) return;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode, forcedMode]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const toggleMode = useCallback(
    () => setModeState((m) => (m === "dark" ? "light" : "dark")), [],
  );

  const theme = useMemo(() => resolveTheme(scheme, mode), [scheme, mode]);

  // Sync the palette used by colors.ts (cube / axis / categorical colours) before
  // children render — these are real computed values, not CSS variables.
  setActiveTheme(theme);

  // Write the chrome CSS variables onto the document root (and the page bg/text)
  // before paint, so the DOM panels track the active palette with no re-render.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = themeToCssVars(theme);
    for (const k in vars) root.style.setProperty(k, vars[k]);
    document.body.style.background = theme.background;
    document.body.style.color = theme.text;
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, mode, scheme, setMode, toggleMode }),
    [theme, mode, scheme, setMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
