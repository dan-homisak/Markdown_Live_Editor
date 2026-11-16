import { FindOptions } from "../../shared/findModel";

/**
 * The find and replace widget: DOM only.
 *
 * It mirrors the stock editor's widget in layout and wording. It knows nothing
 * about the editor: every user action is reported through `FindWidgetActions`,
 * and everything it shows arrives through `update`.
 */
export interface FindWidgetActions {
  queryChanged(query: string): void;
  replacementChanged(replacement: string): void;
  optionToggled(option: keyof FindOptions): void;
  next(): void;
  previous(): void;
  replace(): void;
  replaceAll(): void;
  /** Turn every match into a selection. */
  selectAll(): void;
  toggleReplace(): void;
  close(): void;
}

export interface FindWidgetView {
  open: boolean;
  replaceOpen: boolean;
  query: string;
  replacement: string;
  options: FindOptions;
  /** Null while the query is empty. */
  count: number | null;
  /** More matches exist than were counted. */
  truncated: boolean;
  /** 1-based index of the current match, or 0 when the caret is on none. */
  current: number;
  /** Why the query cannot be searched, for a bad regular expression. */
  invalid: string | null;
  readOnly: boolean;
}

export const FIND_WIDGET_CLASS = "mlrt-find-widget";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ICONS = {
  chevronRight: ["M6 3.5 10.5 8 6 12.5"],
  chevronDown: ["M3.5 6 8 10.5 12.5 6"],
  arrowUp: ["M8 13V3.5", "M4 7.5 8 3.5l4 4"],
  arrowDown: ["M8 3v9.5", "M4 8.5l4 4 4-4"],
  close: ["M4 4l8 8", "M12 4 4 12"],
  replace: ["M2.5 4.5h7", "M7.5 2.5l2 2-2 2", "M4.5 9.5h7v4h-7z"],
  replaceAll: ["M2.5 3.5h6", "M6.5 1.5l2 2-2 2", "M2.5 8.5h7v3h-7z", "M6.5 11.5v2h7v-3h-4"],
} as const;

export class FindWidget {
  public readonly dom: HTMLElement;
  private readonly findInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly replaceRow: HTMLElement;
  private readonly optionButtons: Record<keyof FindOptions, HTMLButtonElement>;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly replaceButton: HTMLButtonElement;
  private readonly replaceAllButton: HTMLButtonElement;
  private readonly findHistory: FieldHistory;
  private readonly replaceHistory: FieldHistory;
  private shown: FindWidgetView | null = null;

  public constructor(mount: HTMLElement, private readonly actions: FindWidgetActions, mac: boolean) {
    const doc = mount.ownerDocument;
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
      const node = doc.createElement(tag);
      node.className = className;
      return node;
    };
    const button = (className: string, label: string, icon: readonly string[] | string, run: () => void): HTMLButtonElement => {
      const node = element("button", `mlrt-find-button ${className}`);
      node.type = "button";
      node.title = label;
      node.setAttribute("aria-label", label);
      if (typeof icon === "string") node.textContent = icon;
      else node.append(renderIcon(doc, icon));
      // Keep focus where it is: a click on a button must not take the caret
      // out of the box the user is typing in.
      node.addEventListener("mousedown", event => event.preventDefault());
      node.addEventListener("click", run);
      return node;
    };
    const key = (windows: string, macKey: string): string => mac ? macKey : windows;

    this.dom = element("div", FIND_WIDGET_CLASS);
    this.dom.setAttribute("role", "dialog");
    this.dom.setAttribute("aria-label", "Find and replace");
    this.dom.hidden = true;

    this.toggle = button("mlrt-find-toggle", "Toggle Replace", ICONS.chevronRight, () => actions.toggleReplace());
    this.toggle.setAttribute("aria-expanded", "false");

    this.findInput = element("input", "mlrt-find-field");
    this.findInput.type = "text";
    this.findInput.placeholder = "Find";
    this.findInput.setAttribute("aria-label", "Find");
    this.findInput.spellcheck = false;
    this.findInput.autocomplete = "off";
    this.findHistory = new FieldHistory(this.findInput);
    this.findInput.addEventListener("input", () => {
      this.findHistory.typed();
      actions.queryChanged(this.findInput.value);
    });

    this.optionButtons = {
      matchCase: button("mlrt-find-option", `Match Case (${key("Alt+C", "⌥⌘C")})`, "Aa", () => actions.optionToggled("matchCase")),
      wholeWord: button("mlrt-find-option mlrt-find-option-word", `Match Whole Word (${key("Alt+W", "⌥⌘W")})`, "ab", () => actions.optionToggled("wholeWord")),
      regex: button("mlrt-find-option", `Use Regular Expression (${key("Alt+R", "⌥⌘R")})`, ".*", () => actions.optionToggled("regex")),
    };
    for (const option of Object.values(this.optionButtons)) option.setAttribute("aria-pressed", "false");
    const findBox = element("div", "mlrt-find-box");
    findBox.append(this.findInput, this.optionButtons.matchCase, this.optionButtons.wholeWord, this.optionButtons.regex);

    this.count = element("div", "mlrt-find-count");
    this.count.setAttribute("aria-live", "polite");
    this.previousButton = button("mlrt-find-previous", `Previous Match (${key("Shift+Enter", "⇧Enter")})`, ICONS.arrowUp, () => actions.previous());
    this.nextButton = button("mlrt-find-next", "Next Match (Enter)", ICONS.arrowDown, () => actions.next());
    const closeButton = button("mlrt-find-close", "Close (Escape)", ICONS.close, () => actions.close());
    const findRow = element("div", "mlrt-find-row");
    findRow.append(findBox, this.count, this.previousButton, this.nextButton, closeButton);

    this.replaceInput = element("input", "mlrt-find-field");
    this.replaceInput.type = "text";
    this.replaceInput.placeholder = "Replace";
    this.replaceInput.setAttribute("aria-label", "Replace");
    this.replaceInput.spellcheck = false;
    this.replaceInput.autocomplete = "off";
    this.replaceHistory = new FieldHistory(this.replaceInput);
    this.replaceInput.addEventListener("input", () => {
      this.replaceHistory.typed();
      actions.replacementChanged(this.replaceInput.value);
    });
    const replaceBox = element("div", "mlrt-find-box");
    replaceBox.append(this.replaceInput);
    this.replaceButton = button("mlrt-find-replace-one", "Replace (Enter)", ICONS.replace, () => actions.replace());
    this.replaceAllButton = button("mlrt-find-replace-all", `Replace All (${key("Ctrl+Alt+Enter", "⌘Enter")})`, ICONS.replaceAll, () => actions.replaceAll());
    this.replaceRow = element("div", "mlrt-find-row mlrt-find-replace-row");
    this.replaceRow.append(replaceBox, this.replaceButton, this.replaceAllButton);
    this.replaceRow.hidden = true;

    const rows = element("div", "mlrt-find-rows");
    rows.append(findRow, this.replaceRow);
    this.dom.append(this.toggle, rows);
    this.dom.addEventListener("keydown", event => this.onKeydown(event, mac));
    mount.append(this.dom);
  }

  public destroy(): void {
    this.dom.remove();
  }

  public contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.dom.contains(target);
  }

  public hasFocus(): boolean {
    return this.dom.contains(this.dom.ownerDocument.activeElement);
  }

  public focusFind(selectAll = true): void {
    this.findInput.focus({ preventScroll: true });
    if (selectAll) this.findInput.select();
  }

  public focusReplace(): void {
    this.replaceInput.focus({ preventScroll: true });
    this.replaceInput.select();
  }

  /** Writes only what differs, so a box being typed in never loses its caret. */
  public update(next: FindWidgetView): void {
    const previous = this.shown;
    this.shown = next;
    if (this.dom.hidden === next.open) this.dom.hidden = !next.open;
    if (!next.open) return;
    // A value that arrives from outside, such as the word at the caret, starts a new history.
    if (this.findInput.value !== next.query) {
      this.findInput.value = next.query;
      this.findHistory.reset();
    }
    if (this.replaceInput.value !== next.replacement) {
      this.replaceInput.value = next.replacement;
      this.replaceHistory.reset();
    }
    if (this.replaceRow.hidden === next.replaceOpen) {
      this.replaceRow.hidden = !next.replaceOpen;
      this.toggle.setAttribute("aria-expanded", String(next.replaceOpen));
      this.toggle.replaceChildren(renderIcon(this.dom.ownerDocument, next.replaceOpen ? ICONS.chevronDown : ICONS.chevronRight));
    }
    for (const option of Object.keys(this.optionButtons) as (keyof FindOptions)[]) {
      const pressed = String(next.options[option]);
      if (this.optionButtons[option].getAttribute("aria-pressed") !== pressed) {
        this.optionButtons[option].setAttribute("aria-pressed", pressed);
      }
    }
    const label = countLabel(next);
    if (this.count.textContent !== label) this.count.textContent = label;
    this.count.title = next.invalid ?? "";
    const failed = next.invalid !== null || (next.count === 0 && next.query.length > 0);
    this.count.classList.toggle("mlrt-find-count-empty", failed);
    this.findInput.parentElement!.classList.toggle("mlrt-find-box-invalid", next.invalid !== null);
    const none = !next.count;
    this.previousButton.disabled = none;
    this.nextButton.disabled = none;
    this.replaceInput.disabled = next.readOnly;
    this.replaceButton.disabled = none || next.readOnly;
    this.replaceAllButton.disabled = none || next.readOnly;
    if (previous?.readOnly !== next.readOnly) {
      this.replaceInput.title = next.readOnly ? "This document is read-only" : "";
    }
  }

  private onKeydown(event: KeyboardEvent, mac: boolean): void {
    // A key press that belongs to an input method, such as the Enter that
    // confirms a candidate, is not a command.
    if (event.isComposing || event.keyCode === 229) return;
    const inFind = event.target === this.findInput;
    const inReplace = event.target === this.replaceInput;
    const primary = mac ? event.metaKey : event.ctrlKey;
    const handled = (run: () => void): void => {
      event.preventDefault();
      event.stopPropagation();
      run();
    };
    const letter = event.key.toLowerCase();
    const undo = primary && !event.altKey && !event.shiftKey && letter === "z";
    const redo = primary && !event.altKey && ((event.shiftKey && letter === "z") || (!mac && !event.shiftKey && letter === "y"));
    if (undo || redo) {
      // Always cancelled: the browser keeps one Undo history for the whole
      // page, and run from here it could take back text typed into the
      // document. Each box keeps the history of what was typed into it.
      handled(() => {
        const history = inFind ? this.findHistory : inReplace ? this.replaceHistory : null;
        if (!history?.step(undo)) return;
        if (inFind) this.actions.queryChanged(this.findInput.value);
        else this.actions.replacementChanged(this.replaceInput.value);
      });
    } else if (event.key === "Escape") {
      handled(() => this.actions.close());
    } else if (event.key === "Enter" && ((mac && event.metaKey) || (!mac && event.ctrlKey && event.altKey))) {
      handled(() => this.actions.replaceAll());
    } else if (event.key === "Enter" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      handled(() => this.actions.selectAll());
    } else if (event.key === "Enter" && inFind && !event.ctrlKey && !event.metaKey && !event.altKey) {
      handled(() => event.shiftKey ? this.actions.previous() : this.actions.next());
    } else if (event.key === "Enter" && inReplace && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      handled(() => this.actions.replace());
    } else if (event.altKey && (mac ? primary : !event.ctrlKey && !event.metaKey) && !event.shiftKey) {
      const option = event.code === "KeyC" ? "matchCase" : event.code === "KeyW" ? "wholeWord" : event.code === "KeyR" ? "regex" : null;
      if (option) handled(() => this.actions.optionToggled(option));
    }
  }
}

/** Pure: the text of the match counter, worded as the stock editor words it. */
export function countLabel(view: Pick<FindWidgetView, "count" | "current" | "truncated" | "invalid">): string {
  if (view.invalid !== null || !view.count) return "No results";
  const total = `${view.count}${view.truncated ? "+" : ""}`;
  return `${view.current > 0 ? view.current : "?"} of ${total}`;
}

function renderIcon(doc: Document, paths: readonly string[]): SVGElement {
  const svg = doc.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of paths) {
    const path = doc.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * Undo and Redo for one text box: the values it held, one step for each time
 * the user changed it. The browser's own history is shared by the whole page
 * and is never used for these boxes.
 */
export class FieldHistory {
  private undone: string[] = [];
  private redone: string[] = [];
  private value: string;

  public constructor(private readonly field: { value: string }, private readonly limit = 100) {
    this.value = field.value;
  }

  /** The user changed the box: remember what it held. */
  public typed(): void {
    const next = this.field.value;
    if (next === this.value) return;
    this.undone.push(this.value);
    if (this.undone.length > this.limit) this.undone.shift();
    this.redone = [];
    this.value = next;
  }

  /** The value was set from outside: there is nothing to go back to. */
  public reset(): void {
    this.undone = [];
    this.redone = [];
    this.value = this.field.value;
  }

  /** Steps back or forward; false when there is nowhere to go. */
  public step(back: boolean): boolean {
    const from = back ? this.undone : this.redone;
    const value = from.pop();
    if (value === undefined) return false;
    (back ? this.redone : this.undone).push(this.value);
    this.field.value = value;
    this.value = value;
    return true;
  }
}
