/** A single keyboard gesture: modifiers plus a DOM key or physical code. */
export interface KeyboardBinding { key: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
type KeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;
const aliases: Record<string, string> = { ctrl: "Control", control: "Control", alt: "Alt", option: "Alt",
  shift: "Shift", cmd: "Meta", command: "Meta", meta: "Meta", win: "Meta", space: " ", spacebar: " ", esc: "Escape", return: "Enter", plus: "+" };
const namedKeys = new Set(["Enter", "Tab", "Escape", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "CapsLock", "NumLock", "ScrollLock", "Pause", "PrintScreen", "ContextMenu",
  "Backquote", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash",
  "IntlBackslash", "IntlRo", "IntlYen", "AudioVolumeMute", "AudioVolumeUp", "AudioVolumeDown", "MediaPlayPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious"]);
export function canonicalKey(value: string): string {
  return aliases[value.toLowerCase()] ?? [...namedKeys].find(key => key.toLowerCase() === value.toLowerCase()) ??
    (/^f\d+$/i.test(value) ? value.toUpperCase() : value.length === 1 ? value.toLowerCase() : value);
}
export function parseKeyboardBinding(value: unknown): KeyboardBinding | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const binding: KeyboardBinding = { key: "", ctrl: false, alt: false, shift: false, meta: false };
  for (const token of value.split("+")) {
    const key = canonicalKey(token.trim());
    if (key === "Control") binding.ctrl = true;
    else if (key === "Alt") binding.alt = true;
    else if (key === "Shift") binding.shift = true;
    else if (key === "Meta") binding.meta = true;
    else if (!binding.key && (key.length === 1 || namedKeys.has(key) || /^(F([1-9]|1\d|2[0-4])|Key[A-Z]|Digit\d|Numpad(\d|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma|ParenLeft|ParenRight|Clear))$/.test(key))) binding.key = key;
    else return null;
  }
  return binding;
}
export function bindingModifiersMatch(binding: KeyboardBinding, event: KeyEvent): boolean {
  return binding.ctrl === event.ctrlKey && binding.alt === event.altKey && binding.shift === event.shiftKey && binding.meta === event.metaKey;
}
export function keyboardBindingMatches(value: string, event: KeyEvent): boolean {
  const binding = parseKeyboardBinding(value);
  return !!binding?.key && bindingModifiersMatch(binding, event) &&
    (binding.key === canonicalKey(event.key) || binding.key === event.code);
}
export const DEFAULT_TABLE_SHORTCUTS = {
  insertRowBelow: "Ctrl+Enter", insertRowAbove: "Ctrl+Shift+Enter",
  insertColumnRight: "Alt+Enter", insertColumnLeft: "Alt+Shift+Enter",
};
export type TableShortcuts = typeof DEFAULT_TABLE_SHORTCUTS;
export function normalizeTableShortcuts(value: unknown, fallback = DEFAULT_TABLE_SHORTCUTS): TableShortcuts {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(fallback).map(([name, defaultKey]) => {
    const key = record[name];
    return [name, typeof key === "string" && (key === "" || parseKeyboardBinding(key)?.key) ? key : defaultKey];
  })) as TableShortcuts;
}
