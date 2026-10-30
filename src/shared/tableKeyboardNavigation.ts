import { canonicalKey, parseKeyboardBinding } from "./keyboardBinding";
/** Common function-key examples; custom keyboard bindings are also supported. */
export const TABLE_NAVIGATION_MODIFIER_KEYS = [
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
] as const;

export type TableNavigationModifierKey = string;

export const DEFAULT_TABLE_NAVIGATION_MODIFIER_KEY: TableNavigationModifierKey =
  "F2";

/** Returns a supported key, falling back safely for stale or invalid settings. */
export function normalizeTableNavigationModifierKey(
  value: unknown,
  fallback: TableNavigationModifierKey =
    DEFAULT_TABLE_NAVIGATION_MODIFIER_KEY,
): TableNavigationModifierKey {
  return typeof value === "string" && parseKeyboardBinding(value)
    ? value
    : fallback;
}

export type TableCellArrowDirection = "up" | "down" | "left" | "right";

export interface TableCellGridAddress {
  /** Header is row 0; body rows begin at row 1. */
  row: number;
  column: number;
}

export interface TableCellGridSize {
  rowCount: number;
  columnCount: number;
}

/** Resolves one geometric (non-wrapping) arrow step inside a table grid. */
export function adjacentTableCell(
  address: TableCellGridAddress,
  direction: TableCellArrowDirection,
  size: TableCellGridSize,
): TableCellGridAddress | null {
  const delta = direction === "up"
    ? { row: -1, column: 0 }
    : direction === "down"
      ? { row: 1, column: 0 }
      : direction === "left"
        ? { row: 0, column: -1 }
        : { row: 0, column: 1 };
  const target = {
    row: address.row + delta.row,
    column: address.column + delta.column,
  };
  return target.row >= 0 &&
      target.row < size.rowCount &&
      target.column >= 0 &&
      target.column < size.columnCount
    ? target
    : null;
}

/** Small testable state machine behind the held-key tracker. */
export class TableNavigationKeyState {
  private readonly held = new Set<TableNavigationModifierKey>();

  public keyDown(key: string): void {
    this.held.add(canonicalKey(key));
  }

  public keyUp(key: string): void {
    this.held.delete(canonicalKey(key));
  }

  public clear(): void {
    this.held.clear();
  }

  public isHeld(key: TableNavigationModifierKey): boolean {
    return this.held.has(canonicalKey(key));
  }
}
