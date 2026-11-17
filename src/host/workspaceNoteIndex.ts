import { createHash } from "crypto";
import * as vscode from "vscode";
import { createWikiNoteIndex, WikiNoteIndex } from "../shared/wikiLinkResolution";

/** The most files one workspace folder contributes; beyond it the listing is marked incomplete. */
export const MAX_INDEXED_FILES = 50_000;
/** File events inside this window are answered by one listing at its end. */
const REFRESH_DELAY_MS = 500;
/** Dependency trees hold tens of thousands of files and no notes. */
const EXCLUDED = "**/node_modules/**";
/** A file search that has not answered by now is treated as failed. */
const LISTING_TIMEOUT_MS = 30_000;
/** A failed listing is tried again by itself, less and less often, up to this. */
const MAX_RETRY_DELAY_MS = 30_000;

interface FolderEntry {
  readonly folder: vscode.WorkspaceFolder;
  /** The editors that asked about this folder, by a key of their own. */
  readonly users: Set<string>;
  readonly watcher: vscode.Disposable;
  /** Settles when the first listing has finished, whether or not it worked. */
  readonly first: Promise<void>;
  /** The latest listing that finished; undefined until one has. */
  ready: WikiNoteIndex | undefined;
  /** What `ready` was made from, to recognize a listing that changed nothing. */
  signature: string;
  listing: boolean;
  /** Files changed while a listing ran: list once more when it ends. */
  again: boolean;
  /** Listings that failed in a row. */
  failures: number;
  /** The first listing has ended, so editors may have been told "unknown". */
  firstSettled: boolean;
  disposed: boolean;
  /** The next listing, and when it is due. */
  timer: ReturnType<typeof setTimeout> | undefined;
  timerDue: number;
  /** Gives up on the listing that is running. */
  listingTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface NoteVault {
  readonly folder: vscode.WorkspaceFolder;
  /** The document's path inside the folder, with forward slashes. */
  readonly sourcePath: string;
  /** The folder's file names now, or undefined while the first listing runs. */
  readonly notes: WikiNoteIndex | undefined;
  /** The same once the first listing has finished; undefined if it failed. */
  readonly listed: Promise<WikiNoteIndex | undefined>;
}

/** The path of `uri` inside `folder`, or null when it is not inside. */
function pathInFolder(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string | null {
  const base = folder.uri.path.endsWith("/") ? folder.uri.path : `${folder.uri.path}/`;
  // Drive letters differ in case between sources; the rest came from one listing.
  return uri.path.length > base.length && uri.path.slice(0, base.length).toLowerCase() === base.toLowerCase()
    ? uri.path.slice(base.length) : null;
}

/**
 * The names of the files in each workspace folder a live editor has asked
 * about, held in memory only. A folder is listed on first use, listed again
 * after files are created or deleted, and forgotten when its last editor
 * closes. Nothing is written to disk and no file is read. Nobody waits for
 * a listing here: a caller gets what is known now.
 */
export class WorkspaceNoteIndex implements vscode.Disposable {
  private readonly entries = new Map<string, FolderEntry>();
  private readonly listeners = new Set<(users: ReadonlySet<string> | undefined) => void>();
  private workspaceListeners: vscode.Disposable | undefined;

  /**
   * Calls back when a folder's files changed, with the editors that use that
   * folder, and with undefined when the workspace folders themselves changed.
   */
  public onDidChange(listener: (users: ReadonlySet<string> | undefined) => void): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => { this.listeners.delete(listener); });
  }

  private fireChanged(users: ReadonlySet<string> | undefined): void {
    for (const listener of Array.from(this.listeners)) {
      // One editor that cannot be told must not stop the others, or the listing.
      try { listener(users); } catch { /* that editor keeps its earlier answers */ }
    }
  }

  /** The vault for a document: its workspace folder. Undefined outside one. */
  public for(document: vscode.Uri, user: string): NoteVault | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(document);
    const sourcePath = folder && pathInFolder(folder, document);
    if (!folder || !sourcePath) return undefined;
    const key = folder.uri.toString();
    let entry = this.entries.get(key);
    if (!entry) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**/*"), false, true, false);
      let settleFirst = (): void => {};
      const created: FolderEntry = { folder, users: new Set(), ready: undefined, signature: "", listing: false,
        again: false, failures: 0, firstSettled: false, disposed: false, timer: undefined, timerDue: 0, listingTimer: undefined,
        first: new Promise<void>(resolve => { settleFirst = resolve; }),
        watcher: vscode.Disposable.from(watcher,
          watcher.onDidCreate(() => this.schedule(created)), watcher.onDidDelete(() => this.schedule(created))) };
      entry = created;
      this.entries.set(key, entry);
      this.workspaceListeners ??= vscode.Disposable.from(
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.dropRemovedFolders()),
        vscode.workspace.onDidChangeConfiguration(event => {
          if (!event.affectsConfiguration("files.exclude")) return;
          for (const each of this.entries.values()) this.schedule(each);
        }));
      this.refresh(entry, settleFirst);
    } else if (entry.failures > 0) {
      // The last listing failed and someone needs it: do not wait out the full retry delay.
      this.schedule(entry);
    }
    entry.users.add(user);
    const current = entry;
    return { folder, sourcePath, notes: entry.ready,
      listed: entry.ready ? Promise.resolve(entry.ready) : entry.first.then(() => current.ready) };
  }

  /** Called when an editor closes; a folder nobody uses stops being watched. */
  public release(user: string): void {
    for (const [key, entry] of this.entries) {
      entry.users.delete(user);
      if (!entry.users.size) this.drop(key, entry);
    }
  }

  public dispose(): void {
    for (const [key, entry] of this.entries) this.drop(key, entry);
    this.workspaceListeners?.dispose();
    this.workspaceListeners = undefined;
    this.listeners.clear();
  }

  private drop(key: string, entry: FolderEntry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (entry.listingTimer !== undefined) clearTimeout(entry.listingTimer);
    entry.timer = entry.listingTimer = undefined;
    entry.disposed = true;
    entry.watcher.dispose();
    this.entries.delete(key);
  }

  private dropRemovedFolders(): void {
    const present = new Set((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.toString()));
    for (const [key, entry] of this.entries) if (!present.has(key)) this.drop(key, entry);
    this.fireChanged(undefined);
  }

  /** Lists the folder after `delay`. A sooner request replaces a later one. */
  private schedule(entry: FolderEntry, delay = REFRESH_DELAY_MS): void {
    if (entry.disposed) return;
    const due = Date.now() + delay;
    if (entry.timer !== undefined) {
      if (entry.timerDue <= due) return;
      clearTimeout(entry.timer);
    }
    entry.timerDue = due;
    entry.timer = setTimeout(() => { entry.timer = undefined; this.refresh(entry); }, delay);
  }

  /** One listing at a time per folder; events during it cause one more after it. */
  private refresh(entry: FolderEntry, settled: () => void = () => {}): void {
    if (entry.listing) { entry.again = true; return; }
    entry.listing = true;
    let ended = false;
    const end = (listed: { notes: WikiNoteIndex; signature: string } | undefined): void => {
      // The search and the timeout both end a listing; the first one counts.
      if (ended) return;
      ended = true;
      if (entry.listingTimer !== undefined) clearTimeout(entry.listingTimer);
      entry.listingTimer = undefined;
      entry.listing = false;
      const toldUnknown = entry.firstSettled && entry.ready === undefined;
      entry.firstSettled = true;
      settled();
      if (entry.disposed) return;
      if (listed) {
        // News when a name appeared or went away, and when editors were
        // answered "unknown" because no listing had worked until now.
        const news = entry.ready ? listed.signature !== entry.signature : toldUnknown;
        entry.failures = 0;
        entry.ready = listed.notes;
        entry.signature = listed.signature;
        if (news) this.fireChanged(entry.users);
      } else {
        // A failed listing keeps what was known before it and is tried again.
        entry.failures++;
        this.schedule(entry, Math.min(MAX_RETRY_DELAY_MS, REFRESH_DELAY_MS * 2 ** entry.failures));
      }
      if (entry.again) { entry.again = false; this.schedule(entry); }
    };
    entry.listingTimer = setTimeout(() => end(undefined), LISTING_TIMEOUT_MS);
    this.list(entry.folder).then(end, () => end(undefined));
  }

  private async list(folder: vscode.WorkspaceFolder): Promise<{ notes: WikiNoteIndex; signature: string }> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*"), EXCLUDED, MAX_INDEXED_FILES + 1);
    const paths: string[] = [];
    for (const file of files.slice(0, MAX_INDEXED_FILES)) {
      const path = pathInFolder(folder, file);
      if (path) paths.push(path);
    }
    paths.sort();
    const complete = files.length <= MAX_INDEXED_FILES;
    const hash = createHash("sha1");
    hash.update(complete ? "complete\n" : "cut\n");
    for (const path of paths) { hash.update(path); hash.update("\n"); }
    return { notes: createWikiNoteIndex(paths, complete), signature: hash.digest("hex") };
  }
}
