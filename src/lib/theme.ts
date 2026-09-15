import { readLocalStorage, writeLocalStorage } from "./browser-storage.js";
import themeCatalog from "./theme-catalog.json";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
type ThemeCatalog = typeof themeCatalog;
type ThemeDefinition = ThemeCatalog["themes"][keyof ThemeCatalog["themes"]];
export type ColorTheme = keyof ThemeCatalog["themes"];
export type ColorThemeOption = ThemeDefinition & { id: ColorTheme };

const themeEntries = Object.entries(themeCatalog.themes) as Array<[ColorTheme, ThemeDefinition]>;
export const colorThemeOptions: ReadonlyArray<ColorThemeOption> = themeEntries.map(
  ([id, definition]) => ({ id, ...definition }),
);
export const colorThemeIds: ReadonlyArray<ColorTheme> = colorThemeOptions.map(
  (option) => option.id,
);

const STORAGE_KEY = themeCatalog.storageKeys.mode;
const COLOR_THEME_STORAGE_KEY = themeCatalog.storageKeys.color;
const DARK_QUERY = "(prefers-color-scheme: dark)";

function paintThemeColor(colorTheme: ColorTheme, resolved: ResolvedTheme): void {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeCatalog.themes[colorTheme].themeColor[resolved]);
}

function isColorTheme(value: string | undefined): value is ColorTheme {
  return value !== undefined && Object.hasOwn(themeCatalog.themes, value);
}

export function readThemePreference(): ThemePreference {
  const stored = readLocalStorage(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

export function readColorTheme(): ColorTheme {
  const stored = readLocalStorage(COLOR_THEME_STORAGE_KEY);
  return isColorTheme(stored) ? stored : "ember";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return globalThis.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  paintThemeColor(readColorTheme(), resolved);
  writeLocalStorage(STORAGE_KEY, preference);
  return resolved;
}

export function applyColorTheme(theme: ColorTheme): void {
  const root = document.documentElement;
  root.dataset.colorTheme = theme;
  paintThemeColor(theme, root.dataset.theme === "dark" ? "dark" : "light");
  writeLocalStorage(COLOR_THEME_STORAGE_KEY, theme);
}

export function watchSystemTheme(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.(DARK_QUERY);
  if (!query) return () => undefined;
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

export function nextThemePreference(preference: ThemePreference): ThemePreference {
  if (preference === "light") return "dark";
  if (preference === "dark") return "system";
  return "light";
}
