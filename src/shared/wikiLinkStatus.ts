import { EditorSourcePosition } from "./editorViewState";

/** Most link targets one request may carry, and the longest one. */
export const MAX_WIKI_STATUS_TARGETS = 200;
export const MAX_WIKI_TARGET_LENGTH = 1000;

/** The webview asks which wikilink targets name an existing file. */
export interface WikiLinkStatusRequest {
  type: "resolveWikiLinks";
  sessionToken: string;
  requestId: number;
  targets: string[];
}

/** The targets that were asked about and one answer for each: found, not found, or not known. */
export interface WikiLinkStatusResult {
  type: "wikiLinkStatus";
  requestId: number;
  targets: string[];
  statuses: (boolean | null)[];
}

/** The files in the workspace folder changed: earlier answers are stale. */
export interface WikiLinksChangedMessage {
  type: "wikiLinksChanged";
}

/** Put the caret at a source position and bring it to the top of the view. */
export interface RevealSourcePositionMessage {
  type: "revealSourcePosition";
  position: EditorSourcePosition;
}

export function isWikiLinkStatusRequest(value: unknown): value is WikiLinkStatusRequest {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "resolveWikiLinks" && typeof message.sessionToken === "string" &&
    Number.isSafeInteger(message.requestId) && (message.requestId as number) > 0 &&
    Array.isArray(message.targets) && message.targets.length > 0 &&
    message.targets.length <= MAX_WIKI_STATUS_TARGETS &&
    message.targets.every(target => typeof target === "string" && target.length <= MAX_WIKI_TARGET_LENGTH);
}

export function isWikiLinkStatusResult(value: unknown): value is WikiLinkStatusResult {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "wikiLinkStatus" && Number.isSafeInteger(message.requestId) &&
    Array.isArray(message.targets) && message.targets.every(target => typeof target === "string") &&
    Array.isArray(message.statuses) && message.statuses.length === message.targets.length &&
    message.statuses.every(status => status === null || typeof status === "boolean");
}

export function isRevealSourcePositionMessage(value: unknown): value is RevealSourcePositionMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.type !== "revealSourcePosition" || !message.position || typeof message.position !== "object") return false;
  const { line, character } = message.position as Record<string, unknown>;
  return Number.isSafeInteger(line) && Number(line) >= 0 && Number.isSafeInteger(character) && Number(character) >= 0;
}

/** How many answers one editor keeps before it starts again. */
export const MAX_KNOWN_WIKI_TARGETS = 2000;

/**
 * What the host has said about note paths, for one editor. An answer is
 * true (exists), false (does not) or null (the host could not tell).
 */
export class WikiLinkAnswers {
  private readonly answers = new Map<string, boolean | null>();
  /** Answers from before the folder's files changed, kept until replaced. */
  private readonly stale = new Map<string, boolean | null>();
  private readonly asked = new Set<string>();

  /**
   * Whether the note is known not to exist. While a new answer is awaited
   * the earlier one still counts, so a dimmed link does not light up between
   * a change to the folder and the answer that follows it.
   */
  public missing(path: string): boolean {
    return (this.answers.has(path) ? this.answers.get(path) : this.stale.get(path)) === false;
  }

  /** Whether the host has yet to be asked about this path. */
  public unanswered(path: string): boolean {
    return !this.answers.has(path) && !this.asked.has(path);
  }

  /** The host is being asked about these paths. */
  public ask(paths: Iterable<string>): void {
    if (this.asked.size > MAX_KNOWN_WIKI_TARGETS) this.asked.clear();
    for (const path of paths) this.asked.add(path);
  }

  /** The host's answers, one for each target it was asked about. */
  public apply(targets: readonly string[], statuses: readonly (boolean | null)[]): void {
    if (this.answers.size + targets.length > MAX_KNOWN_WIKI_TARGETS) this.answers.clear();
    targets.forEach((target, index) => {
      this.asked.delete(target);
      this.stale.delete(target);
      this.answers.set(target, statuses[index] ?? null);
    });
  }

  /** The folder's files changed: every path is to be asked about again. */
  public invalidate(): void {
    if (this.stale.size + this.answers.size > MAX_KNOWN_WIKI_TARGETS) this.stale.clear();
    for (const [target, answer] of this.answers) this.stale.set(target, answer);
    this.answers.clear();
    this.asked.clear();
  }
}
