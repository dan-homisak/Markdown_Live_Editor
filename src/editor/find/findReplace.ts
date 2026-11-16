import { Annotation, ChangeSpec, EditorState, Transaction } from "@codemirror/state";
import { ReplacePlan } from "../../shared/findModel";
import { allowTableSourceChange, TableEditIntent, tableEditIntent } from "../../shared/tableSourceProtection";

/** Marks a change as a find replacement, apart from typing, for anything that filters input. */
export const REPLACE_USER_EVENT = "find.replace";

/** A selection change or a document change that find made itself. */
export const findOwnTransaction = Annotation.define<boolean>();

export type ReplaceTransactions =
  | { ok: true; transactions: Transaction[] }
  /** `table` says the table guard is why: its tables should be refreshed from the document. */
  | { ok: false; reason: string; table: boolean };

/**
 * Turns a replace plan into the transactions that write it, without
 * dispatching anything. Pure: it depends only on its arguments.
 *
 * The transactions are meant for one `view.dispatch([...])`, which makes them
 * one editor update: one change to the document's owner and one Undo step.
 * Prose and tables cannot share a transaction, because a table edit declares
 * that every change it carries lies inside its tables; so the table edit is a
 * second transaction built on the state the prose edit produces.
 *
 * Every transaction is created by `state.update`, so the table change filter
 * judges each of them as it judges any other edit. A plan is all or nothing:
 * when either part is refused, no transaction is returned.
 */
export function planReplaceTransactions(state: EditorState, plan: ReplacePlan): ReplaceTransactions {
  if (plan.refused) {
    return { ok: false, reason: plan.refused, table: true };
  }
  const transactions: Transaction[] = [];
  let current = state;
  if (plan.prose.length > 0) {
    const transaction = current.update({
      changes: plan.prose,
      annotations: findOwnTransaction.of(true),
      userEvent: REPLACE_USER_EVENT,
    });
    if (!transaction.docChanged) {
      return { ok: false, reason: "The replacement could not be applied", table: false };
    }
    transactions.push(transaction);
    current = transaction.state;
  }
  if (plan.cells.length > 0) {
    // Cell edits were planned against the document before the prose changes.
    // No prose change touches a table, so each position moves by a fixed
    // amount whichever side it is mapped to.
    const moved = transactions[0]?.changes;
    const at = (position: number, side: -1 | 1): number => moved ? moved.mapPos(position, side) : position;
    const changes: ChangeSpec[] = plan.cells
      .map(cell => ({ from: at(cell.edit.from, 1), to: at(cell.edit.to, -1), insert: cell.edit.insert }))
      .sort((left, right) => left.from - right.from);
    const only = plan.cells.length === 1 ? plan.cells[0] : null;
    // One cell is declared as that cell, which the guard checks down to the
    // row's cell count. Several cells are declared by their tables, which the
    // guard checks for containment; their rows were proved when the plan was made.
    const intent: TableEditIntent = only
      ? { kind: "cell", tableFrom: at(only.tableFrom, 1), row: only.row, column: only.column }
      : { kind: "tables", tableFroms: [...new Set(plan.cells.map(cell => at(cell.tableFrom, 1)))] };
    const transaction = current.update({
      changes,
      annotations: [allowTableSourceChange.of(true), tableEditIntent.of(intent), findOwnTransaction.of(true)],
      userEvent: REPLACE_USER_EVENT,
    });
    if (!transaction.docChanged) {
      return { ok: false, reason: "the replacement did not match the table it was meant for", table: true };
    }
    transactions.push(transaction);
  }
  return transactions.length > 0
    ? { ok: true, transactions }
    : { ok: false, reason: "Nothing to replace", table: false };
}
