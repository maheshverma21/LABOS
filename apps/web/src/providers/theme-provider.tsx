"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();
const read = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function apply(theme: Theme) {
  const el = document.documentElement;
  // No colour transitions while switching, so everything changes at once.
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);
  el.classList.toggle("dark", theme === "dark");
  el.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts until reload.
  }
  void window.getComputedStyle(document.body).opacity;
  setTimeout(() => style.remove(), 1);
  listeners.forEach((l) => l());
}

interface ThemeContextValue {
  /** The theme in use. Light until the browser says otherwise. */
  theme: Theme;
  resolvedTheme: Theme;
  setTheme: (theme: Theme | string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Light by default; dark when chosen. The choice is kept in this browser. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The server can't know the choice; it renders light and the init script corrects it first.
  const theme = useSyncExternalStore(subscribe, read, () => "light" as Theme);
  const setTheme = useCallback((t: Theme | string) => apply(t === "dark" ? "dark" : "light"), []);
  const value = useMemo(() => ({ theme, resolvedTheme: theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
