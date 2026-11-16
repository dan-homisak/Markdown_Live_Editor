import { Facet, StateEffect, StateField } from "@codemirror/state";
import { compileFindQuery, CompiledFindQuery, FindOptions } from "../../shared/findModel";

/**
 * What the user has asked find for. It lives in the editor state so that it
 * survives document replacements; what was found lives in the find plugin,
 * because it belongs to one exact document.
 */
export interface FindQueryState {
  open: boolean;
  replaceOpen: boolean;
  query: string;
  replacement: string;
  options: FindOptions;
  /** Derived from `query` and `options`; a new object whenever either changes. */
  compiled: CompiledFindQuery;
}

export type FindQueryChange = Partial<Omit<FindQueryState, "compiled" | "options">> & {
  options?: Partial<FindOptions>;
};

/**
 * What the host of the editor supplies. Nothing here is specific to one host:
 * the widget is mounted where it is told to, and the editor is asked, not
 * assumed, whether the document may change.
 */
export interface FindConfig {
  /** A positioned element outside the editor's own root; the widget sits at its top right. */
  mount: HTMLElement;
  isReadOnly?: () => boolean;
  /**
   * False while typed text is still on its way to the document's owner, for a
   * host that sends composed text a moment after the composition ends.
   */
  isInputSettled?: () => boolean;
  /** Status messages for assistive technology and for the user. */
  announce?: (message: string) => void;
}

/**
 * The names under which one editor registers its cell highlights. The registry
 * belongs to the page, so two editors on a page must not share a name.
 */
export interface FindHighlightNames {
  match: string;
  current: string;
}

export interface ResolvedFindConfig extends FindConfig {
  highlightNames: FindHighlightNames;
}

export const findConfig = Facet.define<ResolvedFindConfig, ResolvedFindConfig | null>({
  combine: values => values[0] ?? null,
});

export const setFindState = StateEffect.define<FindQueryChange>();

/** Rebuilds what the find plugin shows after results arrived outside a transaction. */
export const refreshFind = StateEffect.define<null>();

const initialOptions: FindOptions = { matchCase: false, wholeWord: false, regex: false };

const initialState: FindQueryState = {
  open: false,
  replaceOpen: false,
  query: "",
  replacement: "",
  options: initialOptions,
  compiled: compileFindQuery("", initialOptions),
};

export const findStateField = StateField.define<FindQueryState>({
  create: () => initialState,
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setFindState)) next = applyFindChange(next, effect.value);
    }
    return next;
  },
});

/** Pure: the state after `change`, recompiled only when the query could match differently. */
export function applyFindChange(value: FindQueryState, change: FindQueryChange): FindQueryState {
  const options = change.options ? { ...value.options, ...change.options } : value.options;
  const query = change.query ?? value.query;
  const sameQuery = query === value.query &&
    options.matchCase === value.options.matchCase &&
    options.wholeWord === value.options.wholeWord &&
    options.regex === value.options.regex;
  const next: FindQueryState = {
    open: change.open ?? value.open,
    replaceOpen: change.replaceOpen ?? value.replaceOpen,
    query,
    replacement: change.replacement ?? value.replacement,
    options: sameQuery ? value.options : options,
    compiled: sameQuery ? value.compiled : compileFindQuery(query, options),
  };
  const unchanged = sameQuery && next.open === value.open && next.replaceOpen === value.replaceOpen &&
    next.replacement === value.replacement;
  return unchanged ? value : next;
}
