"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { applyTheme, getEffectiveTheme, getSystemTheme } from "@/lib/theme";

type ThemeContextValue = {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  resetToSystem: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: () => {},
  resetToSystem: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Defer so we don't setState synchronously in the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      const effective = getEffectiveTheme();
      setThemeState(effective);
      applyTheme(effective);
    });

    // Listen for system preference changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const saved = localStorage.getItem("zephyr-theme");
      if (!saved) {
        const sys = getSystemTheme();
        setThemeState(sys);
        applyTheme(sys);
      }
    };
    mq.addEventListener("change", handler);
    return () => {
      mq.removeEventListener("change", handler);
      document.documentElement.setAttribute("data-theme", "light");
    };
  }, []);

  const setTheme = (t: "light" | "dark") => {
    setThemeState(t);
    applyTheme(t);
  };

  const resetToSystem = () => {
    localStorage.removeItem("zephyr-theme");
    const sys = getSystemTheme();
    setThemeState(sys);
    document.documentElement.setAttribute("data-theme", sys);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resetToSystem }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
