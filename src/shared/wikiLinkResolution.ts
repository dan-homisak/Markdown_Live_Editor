/**
 * Which file a wikilink names, decided from a listing of the vault alone.
 * Paths are relative to the vault root, with forward slashes and no leading
 * slash. Nothing here reads a file or knows about VS Code.
 */
export interface WikiNoteIndex {
  /** False when the listing was cut off: a name that is missing may still exist. */
  readonly complete: boolean;
  readonly size: number;
  /** Every path whose file name is `name`, compared without regard to case. */
  named(name: string): readonly string[];
}

/** One spelling for a name however it was typed or stored on disk. */
const fold = (value: string): string => value.normalize("NFC").toLowerCase();
const none: readonly string[] = [];

export function createWikiNoteIndex(paths: Iterable<string>, complete = true): WikiNoteIndex {
  const byName = new Map<string, string[]>();
  let size = 0;
  for (const path of paths) {
    const name = fold(path.slice(path.lastIndexOf("/") + 1));
    if (!name) continue;
    const list = byName.get(name);
    if (list) list.push(path); else byName.set(name, [path]);
    size++;
  }
  return { complete, size, named: name => byName.get(fold(name)) ?? none };
}

/** `Note#Heading#Sub` is the note `Note` and the fragment `Heading#Sub`. */
export function splitWikiDestination(destination: string): { path: string; fragment?: string } {
  const hash = destination.indexOf("#");
  if (hash < 0) return { path: destination.trim() };
  const fragment = destination.slice(hash + 1);
  return { path: destination.slice(0, hash).trim(), ...(fragment.trim() ? { fragment } : {}) };
}

const folderOf = (path: string): string[] => path.split("/").slice(0, -1);

/** Folds `.` and `..`; null when the path is malformed or leaves the vault. */
function normalizeSegments(segments: readonly string[]): string[] | null {
  const result: string[] = [];
  for (const segment of segments) {
    if (!segment) return null;
    if (segment === ".") continue;
    if (segment === "..") { if (!result.length) return null; result.pop(); } else result.push(segment);
  }
  return result;
}

/**
 * Of several files a link could mean, the one nearest the vault root, then
 * the first in alphabetical order. Obsidian documents no rule for this case;
 * this one is fixed so that a link never opens a different file on another
 * day, and never asks.
 */
function nearestRoot(paths: readonly string[]): string {
  let best = paths[0], bestDepth = best.split("/").length, bestKey = fold(best);
  for (const path of paths.slice(1)) {
    const depth = path.split("/").length, key = fold(path);
    if (depth < bestDepth || depth === bestDepth && (key < bestKey || key === bestKey && path < best)) {
      best = path; bestDepth = depth; bestKey = key;
    }
  }
  return best;
}

/**
 * The file `linkPath` names when written in the note at `sourcePath`, or
 * null. In order: the path from the vault root; the path from the linking
 * note's folder; any file whose path ends with the link; and among several
 * of those, `nearestRoot`. A path that starts with `./` or `../` is only the
 * second, and one that starts with `/` is only the first. `.md` may be left
 * out; every other extension is written. An empty path is the note itself.
 */
export function resolveWikiLinkPath(linkPath: string, sourcePath: string, index: WikiNoteIndex): string | null {
  const wanted = linkPath.trim();
  if (!wanted) return sourcePath;
  const relative = wanted.startsWith("./") || wanted.startsWith("../");
  const rooted = !relative && wanted.startsWith("/");
  const written = (rooted ? wanted.slice(1) : wanted).split("/");
  const segments = normalizeSegments(relative ? [...folderOf(sourcePath), ...written] : written);
  const name = segments?.pop();
  if (!segments || !name) return null;
  // A name written with an extension is that file first; a bare name is a
  // note first, so `README` is `README.md` and not a file called `README`.
  const hasExtension = /\.[^.\s]+$/u.test(name);
  for (const fileName of hasExtension ? [name, `${name}.md`] : [`${name}.md`, name]) {
    const files = index.named(fileName);
    if (!files.length) continue;
    const fromRoot = fold([...segments, fileName].join("/"));
    const exact = files.find(path => fold(path) === fromRoot);
    if (exact) return exact;
    if (relative || rooted) continue;
    const besideSegments = normalizeSegments([...folderOf(sourcePath), ...segments, fileName]);
    const beside = besideSegments && fold(besideSegments.join("/"));
    const neighbor = beside ? files.find(path => fold(path) === beside) : undefined;
    if (neighbor) return neighbor;
    const ending = `/${fromRoot}`;
    const matches = segments.length ? files.filter(path => fold(path).endsWith(ending)) : files;
    if (matches.length) return nearestRoot(matches);
  }
  return null;
}

/** Whether the note a destination names exists; null when that is not known. */
export function wikiLinkExists(destination: string, sourcePath: string, index: WikiNoteIndex): boolean | null {
  if (resolveWikiLinkPath(splitWikiDestination(destination).path, sourcePath, index) !== null) return true;
  return index.complete ? false : null;
}
