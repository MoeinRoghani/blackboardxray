import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "bxr-theme";

/**
 * The theme, stored per reader.
 *
 * The document already carries the right value before React runs, set by the
 * inline script in index.html, so this hook reads what is there rather than
 * deciding again and repainting.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const attribute = document.documentElement.getAttribute("data-theme");
    return attribute === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // A reader with storage blocked keeps the theme for this page only.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return [theme, toggle];
}
