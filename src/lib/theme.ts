export const THEMES = [
  { id: "crisp", label: "Crisp off-white" },
  { id: "parchment", label: "Parchment" },
  { id: "dark", label: "Dark botanical" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "pm_theme";

/** Runs before first paint so the page never flashes the wrong theme. Falls back to the OS setting. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)t="dark";if(t&&t!=="crisp")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
