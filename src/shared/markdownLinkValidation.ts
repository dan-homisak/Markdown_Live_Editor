import MarkdownIt from "markdown-it";
import { SyntaxNode, Tree } from "@lezer/common";
import { MarkdownRange, MarkdownSource } from "../editor/markdown/markdownSyntax";

// Reuse the existing dependency's CommonMark escaping/reference utilities.
// No markdown-it parse/render pass participates in editor link recognition.
const markdownUtils = new MarkdownIt("zero").utils;
const literalNodes = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "HTMLTag", "Comment", "MarkdownFrontmatter"]);

export interface MarkdownSourceLink extends MarkdownRange {
  destination: string;
  kind: "link" | "reference" | "autolink" | "wiki";
}

export type MarkdownLinkResolution =
  | { ok: true; kind: "external" | "document"; uri: string; fragment?: string }
  | { ok: false; reason: string };

export interface MarkdownOpenLinkRequest {
  type: "openMarkdownLink";
  sessionToken: string;
  requestId: number;
  beforeText: string;
  baseRevision: number;
  from: number;
  to: number;
  activation: "command" | "pointer";
}

export interface MarkdownLinkResult {
  type: "markdownLinkResult";
  requestId: number;
  ok: boolean;
  message?: string;
}

const slice = (source: MarkdownSource, from: number, to: number): string =>
  typeof source === "string" ? source.slice(from, to) : source.sliceString(from, to);
const overlaps = (a: MarkdownRange, b: MarkdownRange): boolean => a.from < b.to && b.from < a.to;
const protectedLink = (link: MarkdownRange, ranges: readonly MarkdownRange[]): boolean =>
  ranges.some(range => overlaps(link, range));

function destinationText(source: MarkdownSource, node: SyntaxNode): string {
  let value = slice(source, node.from, node.to);
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1);
  return markdownUtils.unescapeAll(value);
}

function labelText(source: MarkdownSource, node: SyntaxNode): string {
  return slice(source, node.from + 1, node.to - 1);
}

interface DefinitionCache {
  source: MarkdownSource;
  protectedRanges: readonly MarkdownRange[];
  definitions: Map<string, string>;
}
const definitionsByTree = new WeakMap<Tree, DefinitionCache>();

function referenceDefinitions(
  source: MarkdownSource,
  tree: Tree,
  protectedRanges: readonly MarkdownRange[],
): Map<string, string> {
  const cached = definitionsByTree.get(tree);
  if (cached?.source === source && cached.protectedRanges === protectedRanges) return cached.definitions;
  const definitions = new Map<string, string>();
  tree.iterate({ enter(reference) {
    const node = reference.node;
    if (literalNodes.has(node.name) || protectedLink(node, protectedRanges) && node.name === "LinkReference") return false;
    if (node.name !== "LinkReference") return;
    const label = node.getChild("LinkLabel");
    const url = node.getChild("URL");
    if (!label || !url) return false;
    const normalized = markdownUtils.normalizeReference(labelText(source, label));
    // CommonMark reference labels are compared without entity/backslash
    // decoding, and the first parsed definition wins even when unsupported.
    if (!definitions.has(normalized)) definitions.set(normalized, destinationText(source, url));
    return false;
  } });
  definitionsByTree.set(tree, { source, protectedRanges, definitions });
  return definitions;
}

function linkFromNode(
  source: MarkdownSource,
  tree: Tree,
  node: SyntaxNode,
  protectedRanges: readonly MarkdownRange[],
): MarkdownSourceLink | null {
  if (protectedLink(node, protectedRanges)) return null;
  if (node.name === "WikiLink") {
    const target = node.getChild("WikiTarget");
    return target ? { from: node.from, to: node.to, destination: slice(source, target.from, target.to).trim(), kind: "wiki" } : null;
  }
  if (node.name === "Link") {
    const url = node.getChild("URL");
    if (url) return { from: node.from, to: node.to, destination: destinationText(source, url), kind: "link" };
    // A reference can point beyond the parsed viewport. Do not expose an
    // action until the configured tree has converged for the whole document.
    if (tree.length < source.length) return null;
    const explicitLabel = node.getChild("LinkLabel");
    const marks = node.getChildren("LinkMark");
    const closingLabelMark = marks.find(mark => slice(source, mark.from, mark.to) === "]");
    if (!closingLabelMark) return null;
    const visibleLabel = slice(source, node.from + 1, closingLabelMark.from);
    const label = explicitLabel && explicitLabel.to - explicitLabel.from > 2
      ? labelText(source, explicitLabel) : visibleLabel;
    const destination = referenceDefinitions(source, tree, protectedRanges)
      .get(markdownUtils.normalizeReference(label));
    return destination === undefined ? null
      : { from: node.from, to: node.to, destination, kind: "reference" };
  }
  if (node.name === "Autolink" || node.name === "URL") {
    const url = node.name === "Autolink" ? node.getChild("URL") : node;
    if (!url) return null;
    // Autolinks are literal URI text. Unlike inline/reference destinations,
    // their backslashes and entity spelling are not Markdown-decoded.
    let destination = node.name === "URL" && node.parent?.name === "LinkReference"
      ? destinationText(source, url) : slice(source, url.from, url.to);
    if (/^www\./i.test(destination)) destination = `http://${destination}`;
    else if (!/^[a-z][a-z\d+.-]*:/i.test(destination) && destination.includes("@")) destination = `mailto:${destination}`;
    return { from: node.from, to: node.to, destination, kind: "autolink" };
  }
  return null;
}

/** Source-owned link at a caret; tables, literal code/HTML and images win. */
export function findMarkdownLinkAt(
  source: MarkdownSource,
  tree: Tree,
  position: number,
  protectedRanges: readonly MarkdownRange[] = [],
): MarkdownSourceLink | null {
  if (!Number.isInteger(position) || position < 0 || position > source.length || position > tree.length ||
      protectedRanges.some(range => range.from <= position && position < range.to)) return null;
  for (const side of [1, -1] as const) {
    let candidate: SyntaxNode | null = null;
    for (let node: SyntaxNode | null = tree.resolveInner(position, side); node; node = node.parent) {
      if (literalNodes.has(node.name)) return null;
      // A bare image is source-only, but its alt/destination may be the label
      // of an outer ordinary link. Discard the image URL and keep climbing.
      if (node.name === "Image" || node.name === "WikiEmbed") { candidate = null; continue; }
      if (node.name === "Link" || node.name === "Autolink" || node.name === "WikiLink") candidate = node;
      else if (node.name === "URL" && !candidate) candidate = node;
    }
    if (candidate) return linkFromNode(source, tree, candidate, protectedRanges);
  }
  return null;
}

export function collectMarkdownLinks(
  source: MarkdownSource,
  tree: Tree,
  protectedRanges: readonly MarkdownRange[] = [],
  visibleRanges: readonly MarkdownRange[] = [{ from: 0, to: source.length }],
): MarkdownSourceLink[] {
  const links: MarkdownSourceLink[] = [];
  const seen = new Set<number>();
  for (const window of visibleRanges) {
    tree.iterate({ from: window.from, to: window.to, enter(reference) {
      const node = reference.node;
      if (literalNodes.has(node.name) || node.name === "Image" || node.name === "WikiEmbed") return false;
      if (node.name !== "Link" && node.name !== "Autolink" && node.name !== "URL" && node.name !== "WikiLink") return;
      const link = linkFromNode(source, tree, node, protectedRanges);
      if (link && overlaps(link, window) && !seen.has(link.from)) {
        seen.add(link.from);
        links.push(link);
      }
      return false;
    } });
  }
  return links.sort((a, b) => a.from - b.from);
}

/** A narrow opener policy. URI percent encoding is preserved until URI parsing. */
export function resolveMarkdownLinkDestination(destination: string, documentUri: string | null): MarkdownLinkResolution {
  const rejected = (reason: string): MarkdownLinkResolution => ({ ok: false, reason });
  if (!destination || /[\u0000-\u001f\u007f]/u.test(destination)) return rejected("This link has an empty or invalid destination.");
  const drivePath = /^[a-z]:[\\/]/i.test(destination);
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(destination)?.[1].toLowerCase();
  if (scheme && !drivePath) {
    if (scheme !== "http" && scheme !== "https" && scheme !== "mailto") return rejected("Only HTTP, HTTPS, mailto and document paths can be opened.");
    try {
      // WHATWG special URLs otherwise reinterpret a literal backslash as a
      // slash. Preserve that URI character rather than changing its path.
      const uri = new URL(destination.replace(/\\/g, "%5C"));
      if ((scheme === "http" || scheme === "https") && !uri.hostname) return rejected("This link has no host name.");
      return { ok: true, kind: "external", uri: uri.href };
    } catch { return rejected("This link is not a valid URI."); }
  }
  if (!documentUri) return rejected("Save this document before opening relative document links.");
  try {
    const base = new URL(documentUri);
    if (base.protocol === "untitled:" || !base.pathname.startsWith("/")) return rejected("Save this document before opening document links.");
    if (/^[\\/]{2}/u.test(destination)) return rejected("Network paths cannot change the document's authority.");
    if (drivePath && (base.protocol !== "file:" || base.host)) return rejected("Drive paths require a local file document.");
    const path = base.protocol === "file:" ? destination.replace(/\\/g, "/") : destination;
    const resolved = drivePath ? new URL(`file:///${path}`) : new URL(path, base);
    if (resolved.protocol !== base.protocol || resolved.host !== base.host) return rejected("This path changes the document's URI scheme or authority.");
    const fragment = resolved.hash ? decodeURIComponent(resolved.hash.slice(1)) : undefined;
    resolved.hash = "";
    return { ok: true, kind: "document", uri: resolved.href, ...(fragment ? { fragment } : {}) };
  } catch { return rejected("This document path could not be resolved."); }
}

export function resolveMarkdownSourceLink(link: MarkdownSourceLink, documentUri: string | null): MarkdownLinkResolution {
  if (link.kind !== "wiki") return resolveMarkdownLinkDestination(link.destination, documentUri);
  const [file, ...heading] = link.destination.split("#");
  if (/^[a-z][a-z\d+.-]*:/i.test(file) || /^[\\/]{2}/u.test(file)) {
    return { ok: false, reason: "Wikilinks must name a note or a document path." };
  }
  const note = file && !/\.[^./\\]+$/u.test(file) ? `${file}.md` : file;
  const encoded = note.split("/").map(part => encodeURIComponent(part)).join("/");
  return resolveMarkdownLinkDestination(encoded + (heading.length ? `#${encodeURIComponent(heading.join("#"))}` : ""), documentUri);
}

/** Heading text/slug and Obsidian block IDs share one explicit navigation policy. */
export function markdownFragmentOffset(source: string, tree: Tree, fragment: string): number | null {
  if (fragment.startsWith("^")) {
    const wanted = fragment.slice(1);
    let offset = 0;
    for (const line of source.split("\n")) {
      if (line.trimEnd().endsWith(`^${wanted}`) && /(?:^|\s)\^[\w-]+\s*$/u.test(line)) return offset;
      offset += line.length + 1;
    }
    return null;
  }
  const normalize = (value: string): string => value.replace(/[*_~`]/g, "").trim().toLocaleLowerCase();
  const slug = (value: string): string => normalize(value).replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/gu, "-");
  const wanted = fragment.split("#").map(normalize);
  const ancestry: string[] = [];
  let result: number | null = null;
  tree.iterate({ enter(ref) {
    if (result !== null || literalNodes.has(ref.name)) return false;
    const heading = /^(?:ATX|Setext)Heading([1-6])$/u.exec(ref.name);
    if (!heading) return;
    const level = Number(heading[1]);
    const text = source.slice(ref.from, ref.to).split("\n")[0].replace(/^#{1,6}\s+/u, "").replace(/\s+#+\s*$/u, "");
    ancestry.length = level - 1; ancestry[level - 1] = normalize(text);
    if (wanted.length === 1 ? (normalize(text) === wanted[0] || slug(text) === wanted[0])
      : wanted.every((part, index) => ancestry.slice(-wanted.length)[index] === part)) result = ref.from;
  } });
  return result;
}

export function isMarkdownOpenLinkRequest(value: unknown): value is MarkdownOpenLinkRequest {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "openMarkdownLink" && typeof message.sessionToken === "string" &&
    typeof message.beforeText === "string" &&
    Number.isSafeInteger(message.requestId) && (message.requestId as number) > 0 &&
    Number.isSafeInteger(message.baseRevision) && (message.baseRevision as number) >= 0 &&
    Number.isSafeInteger(message.from) && (message.from as number) >= 0 &&
    Number.isSafeInteger(message.to) && (message.to as number) > (message.from as number) &&
    (message.activation === "command" || message.activation === "pointer");
}
