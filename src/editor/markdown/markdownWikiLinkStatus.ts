import { Extension, Facet, Range, StateEffect } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { collectMarkdownLinks } from "../../shared/markdownLinkValidation";
import { getParsedTables } from "../../shared/tableModel";
import { splitWikiDestination } from "../../shared/wikiLinkResolution";
import { MAX_WIKI_STATUS_TARGETS, MAX_WIKI_TARGET_LENGTH, WikiLinkAnswers } from "../../shared/wikiLinkStatus";
import { markdownCompositionEffect, markdownRenderTree } from "./markdownRenderTree";

/**
 * Wikilinks whose note does not exist are drawn dimmed. Only the host can
 * see the folder, so the editor asks it about the links in view and paints
 * the answers; a link it has no answer for is drawn as an ordinary link.
 */
export interface WikiLinkStatusOptions {
  enabled: boolean;
  /** Ask which of these note paths exist. Answers return through `applyWikiLinkStatus`. */
  request: (targets: readonly string[]) => void;
}

const configuration = Facet.define<WikiLinkStatusOptions, WikiLinkStatusOptions | null>({ combine: values => values[0] ?? null });
const refreshEffect = StateEffect.define<null>();
const unresolvedMark = Decoration.mark({ class: "mlrt-markdown-link-unresolved" });
/** Typing a link's name asks once for the name it settles on, not once per key. */
const REQUEST_DELAY_MS = 120;

// Kept per view, so reconfiguring the editor does not ask everything again.
const answersByView = new WeakMap<EditorView, WikiLinkAnswers>();
function answersFor(view: EditorView): WikiLinkAnswers {
  let answers = answersByView.get(view);
  if (!answers) answersByView.set(view, answers = new WikiLinkAnswers());
  return answers;
}

/** The note paths of the wikilinks in view, with where each link is. */
function visibleWikiLinks(view: EditorView): { from: number; to: number; path: string }[] {
  const state = view.state, result: { from: number; to: number; path: string }[] = [];
  for (const link of collectMarkdownLinks(state.doc, markdownRenderTree(state), getParsedTables(state.doc), view.visibleRanges)) {
    if (link.kind !== "wiki") continue;
    const path = splitWikiDestination(link.destination).path;
    // An empty path is this note, which exists.
    if (path && path.length <= MAX_WIKI_TARGET_LENGTH) result.push({ from: link.from, to: link.to, path });
  }
  return result;
}

class WikiLinkStatus {
  decorations: DecorationSet;
  private composing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly view: EditorView) { this.decorations = this.build(); }

  update(update: ViewUpdate): void {
    const wasComposing = this.composing;
    let refresh = false;
    for (const transaction of update.transactions) for (const effect of transaction.effects) {
      if (effect.is(markdownCompositionEffect)) this.composing = effect.value;
      else if (effect.is(refreshEffect)) refresh = true;
    }
    // Presentation holds still while text is being composed.
    if (this.composing) { this.decorations = this.decorations.map(update.changes); return; }
    if (refresh || wasComposing || update.docChanged || update.viewportChanged ||
        update.startState.facet(configuration) !== update.state.facet(configuration) ||
        markdownRenderTree(update.startState) !== markdownRenderTree(update.state)) this.decorations = this.build();
  }

  private build(): DecorationSet {
    if (!this.view.state.facet(configuration)?.enabled) return Decoration.none;
    const answers = answersFor(this.view), marks: Range<Decoration>[] = [];
    let unanswered = false;
    for (const link of visibleWikiLinks(this.view)) {
      if (answers.missing(link.path)) marks.push(unresolvedMark.range(link.from, link.to));
      if (answers.unanswered(link.path)) unanswered = true;
    }
    if (unanswered) this.schedule();
    return Decoration.set(marks, true);
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.ask(); }, REQUEST_DELAY_MS);
  }

  private ask(): void {
    const options = this.view.state.facet(configuration);
    if (!options?.enabled) return;
    const answers = answersFor(this.view), targets = new Set<string>();
    for (const link of visibleWikiLinks(this.view)) {
      if (targets.size >= MAX_WIKI_STATUS_TARGETS) break;
      if (answers.unanswered(link.path)) targets.add(link.path);
    }
    if (!targets.size) return;
    answers.ask(targets);
    options.request(Array.from(targets));
  }

  destroy(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

const statusPlugin = ViewPlugin.fromClass(WikiLinkStatus, { decorations: plugin => plugin.decorations });

/** The host's answers, one for each target it was asked about. */
export function applyWikiLinkStatus(view: EditorView, targets: readonly string[], statuses: readonly (boolean | null)[]): void {
  answersFor(view).apply(targets, statuses);
  view.dispatch({ effects: refreshEffect.of(null) });
}

/**
 * Files were created or deleted: ask again for what is in view. The earlier
 * answers stay painted until they are replaced.
 */
export function invalidateWikiLinkStatus(view: EditorView): void {
  answersFor(view).invalidate();
  view.dispatch({ effects: refreshEffect.of(null) });
}

export function createWikiLinkStatusExtension(options: WikiLinkStatusOptions): Extension {
  return [configuration.of(options), statusPlugin];
}
