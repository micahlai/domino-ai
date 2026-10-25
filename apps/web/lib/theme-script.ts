// Pure and React-free: the server layout imports this for the pre-paint script, like style-registry.

export const THEME_STORAGE_KEY = "domino-theme";

/** Runs before first paint so a dark choice never flashes light. Light unless "dark" is stored. */
export const themeInitScript = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`;
