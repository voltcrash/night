import { readLocalStorage, writeLocalStorage } from "./browser-storage.js";

export const shortcutActions = [
  { id: "commandPalette", label: "Command palette" },
  { id: "searchNotes", label: "Search all notes" },
  { id: "newNote", label: "New note" },
  { id: "saveNote", label: "Save note" },
  { id: "cutSelection", label: "Cut selection" },
  { id: "copySelection", label: "Copy selection" },
  { id: "paste", label: "Paste" },
  { id: "undo", label: "Undo" },
  { id: "redo", label: "Redo" },
  { id: "selectAll", label: "Select all" },
  { id: "bold", label: "Bold selection" },
  { id: "italic", label: "Italic selection" },
  { id: "togglePreview", label: "Toggle page pane" },
  { id: "toggleSidebar", label: "Toggle sidebar" },
  { id: "cycleTheme", label: "Cycle theme" },
  { id: "focusSearch", label: "Focus search" },
  { id: "openShortcuts", label: "Open this section" },
  { id: "closePanel", label: "Close any panel" },
] as const;

export type ShortcutAction = (typeof shortcutActions)[number]["id"];

export interface KeyboardShortcut {
  key: string;
  primary?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type PrimaryModifier = "meta" | "control";

export type KeyboardShortcuts = Record<ShortcutAction, KeyboardShortcut | null>;

const STORAGE_KEY = "onyx:keyboard-shortcuts";

export const defaultKeyboardShortcuts: KeyboardShortcuts = {
  commandPalette: { key: "k", primary: true },
  searchNotes: { key: "f", primary: true, shift: true },
  newNote: { key: "Enter", primary: true },
  saveNote: { key: "s", primary: true },
  cutSelection: { key: "x", primary: true },
  copySelection: { key: "c", primary: true },
  paste: { key: "v", primary: true },
  undo: { key: "z", primary: true },
  redo: { key: "z", primary: true, shift: true },
  selectAll: { key: "a", primary: true },
  bold: { key: "b", primary: true },
  italic: { key: "i", primary: true },
  togglePreview: { key: "p", primary: true, shift: true },
  toggleSidebar: { key: "\\", primary: true },
  cycleTheme: { key: "l", primary: true, shift: true },
  focusSearch: { key: "/" },
  openShortcuts: { key: "?", shift: true },
  closePanel: { key: "Escape" },
};

export function readKeyboardShortcuts(): KeyboardShortcuts {
  const stored = readLocalStorage(STORAGE_KEY);
  if (!stored) return structuredClone(defaultKeyboardShortcuts);
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return structuredClone(defaultKeyboardShortcuts);
    const shortcuts = structuredClone(defaultKeyboardShortcuts);
    for (const { id } of shortcutActions) {
      const value = (parsed as Record<string, unknown>)[id];
      if (value === null || isKeyboardShortcut(value)) shortcuts[id] = value;
    }
    return shortcuts;
  } catch {
    return structuredClone(defaultKeyboardShortcuts);
  }
}

export function writeKeyboardShortcuts(shortcuts: KeyboardShortcuts): boolean {
  return writeLocalStorage(STORAGE_KEY, JSON.stringify(shortcuts));
}

export function detectPrimaryModifier(
  platformNavigator:
    | (Pick<Navigator, "platform" | "userAgent"> & {
        userAgentData?: { platform?: string };
      })
    | undefined = typeof navigator === "undefined" ? undefined : navigator,
): PrimaryModifier {
  const platform =
    platformNavigator?.userAgentData?.platform ||
    platformNavigator?.platform ||
    platformNavigator?.userAgent ||
    "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "meta" : "control";
}

export function shortcutFromEvent(
  event: KeyboardEvent,
  primaryModifier: PrimaryModifier = detectPrimaryModifier(),
): KeyboardShortcut | undefined {
  if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return undefined;
  const primaryPressed = primaryModifier === "meta" ? event.metaKey : event.ctrlKey;
  if ((event.metaKey || event.ctrlKey) && !primaryPressed) return undefined;
  return {
    key: normalizeKey(event.key),
    primary: primaryPressed || undefined,
    shift: event.shiftKey || undefined,
    alt: event.altKey || undefined,
  };
}

export function shortcutMatchesEvent(
  shortcut: KeyboardShortcut | null,
  event: KeyboardEvent,
  primaryModifier: PrimaryModifier = detectPrimaryModifier(),
): boolean {
  if (!shortcut) return false;
  const expectsPrimary = Boolean(shortcut.primary);
  return (
    normalizeKey(event.key) === shortcut.key &&
    event.metaKey === (expectsPrimary && primaryModifier === "meta") &&
    event.ctrlKey === (expectsPrimary && primaryModifier === "control") &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.altKey === Boolean(shortcut.alt)
  );
}

export function shortcutsEqual(
  left: KeyboardShortcut | null,
  right: KeyboardShortcut | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.key === right.key &&
    Boolean(left.primary) === Boolean(right.primary) &&
    Boolean(left.shift) === Boolean(right.shift) &&
    Boolean(left.alt) === Boolean(right.alt)
  );
}

export function formatShortcut(
  shortcut: KeyboardShortcut | null,
  primaryModifier: PrimaryModifier = "meta",
): string {
  if (!shortcut) return "Not set";
  return shortcutParts(shortcut, primaryModifier).join(primaryModifier === "meta" ? " " : " + ");
}

export function shortcutParts(
  shortcut: KeyboardShortcut,
  primaryModifier: PrimaryModifier = "meta",
): string[] {
  const parts = [
    shortcut.primary ? (primaryModifier === "meta" ? "⌘" : "Ctrl") : "",
    shortcut.alt ? (primaryModifier === "meta" ? "⌥" : "Alt") : "",
    shortcut.shift ? (primaryModifier === "meta" ? "⇧" : "Shift") : "",
    displayKey(shortcut.key),
  ];
  return parts.filter(Boolean);
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function displayKey(key: string): string {
  if (key === "Enter") return "⏎";
  if (key === "Escape") return "Esc";
  if (key === " ") return "Space";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  return key.length === 1 ? key.toUpperCase() : key;
}

function isKeyboardShortcut(value: unknown): value is KeyboardShortcut {
  if (!value || typeof value !== "object") return false;
  const shortcut = value as Record<string, unknown>;
  return (
    typeof shortcut.key === "string" &&
    shortcut.key.length > 0 &&
    (shortcut.primary === undefined || typeof shortcut.primary === "boolean") &&
    (shortcut.shift === undefined || typeof shortcut.shift === "boolean") &&
    (shortcut.alt === undefined || typeof shortcut.alt === "boolean")
  );
}
