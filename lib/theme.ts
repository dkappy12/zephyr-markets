export type Theme = "light" | "dark" | "system";

export function applyTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("zephyr-theme", theme);
}

export function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getEffectiveTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("zephyr-theme") as "light" | "dark" | null;
    if (saved === "light" || saved === "dark") return saved;
    return getSystemTheme();
  } catch {
    return "light";
  }
}
