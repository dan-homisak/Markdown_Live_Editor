import { ChangeDesc, EditorState, StateEffect, StateField } from "@codemirror/state";
import { getParsedTables, ParsedTable } from "../../shared/tableModel";

/**
 * A parsed table plus a stable identity that survives document edits.
 *
 * The `table` object is always the memoized parse of the state's current
 * document (`getParsedTables(state.doc)`), so its offsets are authoritative
 * for that state and must never be mutated.
 */
export interface TrackedTable {
  readonly id: number;
  readonly table: ParsedTable;
}

export interface TableTrackingState {
  readonly tables: readonly TrackedTable[];
  /**
   * Bumped by `tableResyncEffect`. Rendered widgets include it in their
   * equality so a resync re-patches every mounted table from its source.
   */
  readonly renderGeneration: number;
}

/**
 * Forces every mounted table widget to re-patch from the current source.
 * Dispatched when a table edit is refused because the DOM no longer matches
 * the document, so the user immediately sees the authoritative content.
 */
export const tableResyncEffect = StateEffect.define<null>();

let nextTableId = 1;

/**
 * Single source of truth for "which table is which" in the live editor.
 *
 * Every document change re-parses tables from the new document, then carries
 * each table's identity forward by mapping the previous table ranges through
 * the change and matching them to the new tables by overlap. Rendered widgets,
 * range selections, and every table mutation address a table by this id and
 * resolve its *current* source offsets from this field at the moment they
 * act. Nothing reuses offsets captured before the latest transaction.
 */
export const tableTrackingField = StateField.define<TableTrackingState>({
  create(state) {
    return {
      tables: getParsedTables(state.doc).map((table) => ({ id: nextTableId++, table })),
      renderGeneration: 0,
    };
  },
  update(value, transaction) {
    const resync = transaction.effects.some((effect) => effect.is(tableResyncEffect));
    if (!transaction.docChanged && !resync) {
      return value;
    }
    return {
      tables: transaction.docChanged
        ? carryTableIdentities(
          value.tables,
          transaction.changes,
          getParsedTables(transaction.state.doc),
        )
        : value.tables,
      renderGeneration: value.renderGeneration + (resync ? 1 : 0),
    };
  },
});

export function getTrackedTables(state: EditorState): readonly TrackedTable[] {
  return state.field(tableTrackingField, false)?.tables ?? [];
}

export function tableRenderGeneration(state: EditorState): number {
  return state.field(tableTrackingField, false)?.renderGeneration ?? 0;
}

export function findTrackedTable(
  state: EditorState,
  id: number,
): TrackedTable | undefined {
  return getTrackedTables(state).find((entry) => entry.id === id);
}

export function trackedTableAt(
  state: EditorState,
  from: number,
): TrackedTable | undefined {
  return getTrackedTables(state).find((entry) => entry.table.from === from);
}

/**
 * Matches new tables to previous identities.
 *
 * Previous ranges are mapped *inward*: the start associates forward and the
 * end backward, so text inserted against either edge (including a whole new
 * table typed or pasted right before or after) is never counted as part of
 * the old table. A replacement of the whole table still maps onto its
 * replacement. Identities are then assigned by largest overlap first, so a
 * new neighbour can never claim an existing table's identity. Tables with no
 * overlapping predecessor (new, or split off another table) get a fresh id;
 * deleted tables simply disappear.
 */
export function carryTableIdentities(
  previous: readonly TrackedTable[],
  changes: ChangeDesc,
  tables: readonly ParsedTable[],
  allocateId: () => number = () => nextTableId++,
): TrackedTable[] {
  const mapped = previous.map((entry) => ({
    id: entry.id,
    from: changes.mapPos(entry.table.from, 1),
    to: changes.mapPos(entry.table.to, -1),
  }));
  const pairs: { table: number; id: number; overlap: number }[] = [];
  let first = 0;
  tables.forEach((table, tableIndex) => {
    while (first < mapped.length && mapped[first].to <= table.from) {
      first++;
    }
    for (let index = first; index < mapped.length && mapped[index].from < table.to; index++) {
      const candidate = mapped[index];
      const overlap = Math.min(candidate.to, table.to) - Math.max(candidate.from, table.from);
      if (overlap > 0) {
        pairs.push({ table: tableIndex, id: candidate.id, overlap });
      }
    }
  });
  pairs.sort((left, right) => right.overlap - left.overlap || left.table - right.table);
  const assigned = new Map<number, number>();
  const claimed = new Set<number>();
  for (const pair of pairs) {
    if (!assigned.has(pair.table) && !claimed.has(pair.id)) {
      assigned.set(pair.table, pair.id);
      claimed.add(pair.id);
    }
  }
  return tables.map((table, tableIndex) => ({
    id: assigned.get(tableIndex) ?? allocateId(),
    table,
  }));
}
