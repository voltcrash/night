import { readLocalStorage, writeLocalStorage } from "./browser-storage.js";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ColorTheme =
  | "ember"
  | "monochrome"
  | "ocean"
  | "phosphor"
  | "graphite"
  | "marigold"
  | "espresso"
  | "ink"
  | "lavender"
  | "burgundy"
  | "rose"
  | "solarized";

export const colorThemeOptions: ReadonlyArray<{ id: ColorTheme; label: string; hint: string }> = [
  { id: "ember", label: "Ember", hint: "Warm paper with a terracotta accent." },
  { id: "monochrome", label: "Monochrome", hint: "Pure black and white, with no accent hue." },
  { id: "ocean", label: "Ocean", hint: "Cool blue-gray surfaces with a clear teal accent." },
  {
    id: "phosphor",
    label: "Forest",
    hint: "Graphite surfaces with a vivid evergreen accent.",
  },
  {
    id: "graphite",
    label: "Graphite",
    hint: "Balanced gray surfaces with a quiet steel-blue accent.",
  },
  {
    id: "marigold",
    label: "Marigold",
    hint: "Golden paper with a sunny ochre accent.",
  },
  {
    id: "espresso",
    label: "Espresso",
    hint: "Velvety roasted cocoa surfaces with a glowing caramel accent.",
  },
  {
    id: "ink",
    label: "Ink",
    hint: "Cool writing paper with a deep cobalt blue accent, like a fountain pen.",
  },
  {
    id: "lavender",
    label: "Lavender",
    hint: "Soft lilac surfaces with a thoughtful violet accent.",
  },
  { id: "burgundy", label: "Burgundy", hint: "Deep wine surfaces with a restrained ruby accent." },
  { id: "rose", label: "Rose", hint: "Soft pink paper with a lively rose accent." },
  {
    id: "solarized",
    label: "Solarized",
    hint: "Low-contrast blue-gold tones built for long sessions.",
  },
];

const STORAGE_KEY = "onyx-theme";
const COLOR_THEME_STORAGE_KEY = "onyx-color-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const THEME_COLOR: Record<ColorTheme, Record<ResolvedTheme, string>> = {
  ember: { light: "#fbfaf7", dark: "#1b1b19" },
  monochrome: { light: "#ffffff", dark: "#000000" },
  ocean: { light: "#f8fcfd", dark: "#14242c" },
  phosphor: { light: "#f7faf7", dark: "#1a1f1a" },
  graphite: { light: "#f7f8fa", dark: "#1a1f24" },
  marigold: { light: "#fff9e8", dark: "#2b2410" },
  espresso: { light: "#f7f3ee", dark: "#261e1b" },
  ink: { light: "#f8fbff", dark: "#16233a" },
  lavender: { light: "#fbfaff", dark: "#211a2a" },
  burgundy: { light: "#fbf4f2", dark: "#28141b" },
  rose: { light: "#fff8fc", dark: "#281523" },
  solarized: { light: "#fdf6e3", dark: "#073642" },
};

function paintThemeColor(colorTheme: ColorTheme, resolved: ResolvedTheme): void {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[colorTheme][resolved]);
}

export function readThemePreference(): ThemePreference {
  const stored = readLocalStorage(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

export function readColorTheme(): ColorTheme {
  const stored = readLocalStorage(COLOR_THEME_STORAGE_KEY);
  return colorThemeOptions.some((option) => option.id === stored)
    ? (stored as ColorTheme)
    : "ember";
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
