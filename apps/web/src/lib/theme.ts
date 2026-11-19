/** Same key next-themes used, so people keep the theme they picked. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Runs before the page paints (rendered by the root layout, a server component,
 * so React doesn't warn about it): applies the saved theme so dark mode doesn't
 * flash white. Light unless "dark" was chosen.
 */
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark";var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}`;
