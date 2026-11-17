import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWikiNoteIndex,
  resolveWikiLinkPath,
  splitWikiDestination,
  wikiLinkExists,
} from "../shared/wikiLinkResolution";
import { isWikiLinkStatusRequest, isWikiLinkStatusResult, MAX_WIKI_STATUS_TARGETS, WikiLinkAnswers } from "../shared/wikiLinkStatus";

const vault = createWikiNoteIndex([
  "Home.md",
  "Alpha.md",
  "projects/Alpha.md",
  "projects/Plan.md",
  "projects/Beta.md",
  "archive/Beta.md",
  "archive/2024/Gamma.md",
  "deep/er/Gamma.md",
  "zeta/Gamma.md",
  "projects/Note v1.2.md",
  "assets/Figure 1.png",
  "assets/report.pdf",
  "assets/report.pdf.md",
  "README.md",
  "vendor/README",
  "LICENSE",
  "Caf\u00e9.md",
  "a/b/Leaf.md",
  "x/b/Leaf.md",
]);
const from = (source: string) => (link: string): string | null => resolveWikiLinkPath(link, source, vault);

test("a destination splits at the first # into a path and a fragment", () => {
  assert.deepEqual(splitWikiDestination("Note"), { path: "Note" });
  assert.deepEqual(splitWikiDestination(" Note #Heading"), { path: "Note", fragment: "Heading" });
  assert.deepEqual(splitWikiDestination("Note#One#Two"), { path: "Note", fragment: "One#Two" });
  assert.deepEqual(splitWikiDestination("#Heading"), { path: "", fragment: "Heading" });
  assert.deepEqual(splitWikiDestination("Note#^block"), { path: "Note", fragment: "^block" });
  assert.deepEqual(splitWikiDestination("Note#"), { path: "Note" });
});

test("a name resolves without its .md, without regard to case, and keeps the file's own spelling", () => {
  const link = from("Home.md");
  assert.equal(link("Home"), "Home.md");
  assert.equal(link("home"), "Home.md");
  assert.equal(link("HOME.MD"), "Home.md");
  assert.equal(link("Plan"), "projects/Plan.md");
  assert.equal(link("Missing"), null);
  assert.equal(link("Cafe\u0301"), "Caf\u00e9.md", "composed and decomposed spellings are one name");
});

test("an empty path is the linking note itself", () => {
  assert.equal(from("projects/Plan.md")(""), "projects/Plan.md");
});

test("a path from the vault root wins over the note beside the linking file", () => {
  // Alpha.md exists at the root and in projects/. A link from inside
  // projects/ reaches the root note: the same link means the same note
  // wherever it is written.
  assert.equal(from("projects/Plan.md")("Alpha"), "Alpha.md");
  assert.equal(from("Home.md")("Alpha"), "Alpha.md");
  assert.equal(from("Home.md")("projects/Alpha"), "projects/Alpha.md");
  assert.equal(from("archive/Beta.md")("projects/Alpha"), "projects/Alpha.md");
});

test("with no note at the root, the one beside the linking file wins", () => {
  assert.equal(from("projects/Plan.md")("Beta"), "projects/Beta.md");
  assert.equal(from("archive/2024/Gamma.md")("../Beta"), "archive/Beta.md");
  assert.equal(from("archive/Beta.md")("Beta"), "archive/Beta.md");
  assert.equal(from("archive/Beta.md")("2024/Gamma"), "archive/2024/Gamma.md");
});

test("several notes of one name never ask: the shortest path wins, then alphabetical order", () => {
  // From the root, neither Beta is at the root or beside the linking file.
  assert.equal(from("Home.md")("Beta"), "archive/Beta.md");
  // zeta/Gamma.md is nearer the root than the other two.
  assert.equal(from("Home.md")("Gamma"), "zeta/Gamma.md");
  assert.equal(from("projects/Plan.md")("Gamma"), "zeta/Gamma.md");
});

test("a partial path matches the end of a longer path", () => {
  assert.equal(from("Home.md")("2024/Gamma"), "archive/2024/Gamma.md");
  assert.equal(from("Home.md")("er/Gamma"), "deep/er/Gamma.md");
  assert.equal(from("Home.md")("b/Leaf"), "a/b/Leaf.md", "two matches: alphabetical order at equal depth");
  assert.equal(from("Home.md")("x/b/Leaf"), "x/b/Leaf.md");
  assert.equal(from("Home.md")("4/Gamma"), null, "a folder name is matched whole");
});

test("./ and ../ are relative to the linking file and a leading / is the vault root, each exact", () => {
  assert.equal(from("projects/Plan.md")("./Alpha"), "projects/Alpha.md");
  assert.equal(from("projects/Plan.md")("../Alpha"), "Alpha.md");
  assert.equal(from("projects/Plan.md")("/Alpha"), "Alpha.md");
  assert.equal(from("projects/Plan.md")("/projects/Alpha"), "projects/Alpha.md");
  assert.equal(from("Home.md")("./Plan"), null, "an explicit path is not searched for elsewhere");
  assert.equal(from("Home.md")("/Plan"), null);
  assert.equal(from("Home.md")("../Home"), null, "a path cannot leave the vault");
  assert.equal(from("projects/Plan.md")("../../Home"), null);
  assert.equal(from("Home.md")("projects/../Home"), "Home.md");
});

test("a name with a dot in it is still a note name", () => {
  assert.equal(from("Home.md")("Note v1.2"), "projects/Note v1.2.md");
});

test("other files are linked by their full name", () => {
  const link = from("Home.md");
  assert.equal(link("Figure 1.png"), "assets/Figure 1.png");
  assert.equal(link("Figure 1"), null, "only .md may be left out");
  assert.equal(link("report.pdf"), "assets/report.pdf", "a name written with an extension is that file first");
  assert.equal(link("report.pdf.md"), "assets/report.pdf.md");
  assert.equal(link("LICENSE"), "LICENSE", "a file with no extension is reached when no note has the name");
  assert.equal(link("README"), "README.md", "a name written without an extension is a note first");
  assert.equal(link("vendor/README"), "vendor/README");
});

test("nothing outside the listing can be reached", () => {
  const link = from("Home.md");
  for (const target of ["javascript:alert(1)", "http://example.test/Home", "C:/Home", "//server/share/Home", "folder/", "/", "..", "."]) {
    assert.equal(link(target), null, target);
  }
});

test("existence is about the note, not the heading, and is unknown when the listing was cut off", () => {
  assert.equal(wikiLinkExists("Home", "Home.md", vault), true);
  assert.equal(wikiLinkExists("Home#No such heading", "Home.md", vault), true);
  assert.equal(wikiLinkExists("#Heading", "Home.md", vault), true);
  assert.equal(wikiLinkExists("Missing", "Home.md", vault), false);
  assert.equal(wikiLinkExists("Missing#Heading", "Home.md", vault), false);
  const partial = createWikiNoteIndex(["Home.md"], false);
  assert.equal(partial.complete, false);
  assert.equal(wikiLinkExists("Home", "Home.md", partial), true);
  assert.equal(wikiLinkExists("Missing", "Home.md", partial), null);
  assert.equal(vault.size, 19);
});

test("a status request is bounded and typed", () => {
  const request = { type: "resolveWikiLinks", sessionToken: "token", requestId: 1, targets: ["Home", "Missing#x"] };
  assert.equal(isWikiLinkStatusRequest(request), true);
  assert.equal(isWikiLinkStatusRequest({ ...request, targets: [] }), false);
  assert.equal(isWikiLinkStatusRequest({ ...request, targets: [1] }), false);
  assert.equal(isWikiLinkStatusRequest({ ...request, requestId: 0 }), false);
  assert.equal(isWikiLinkStatusRequest({ ...request, sessionToken: 1 }), false);
  assert.equal(isWikiLinkStatusRequest({ ...request, type: "openMarkdownLink" }), false);
  assert.equal(isWikiLinkStatusRequest({ ...request, targets: Array(MAX_WIKI_STATUS_TARGETS + 1).fill("a") }), false);
  assert.equal(isWikiLinkStatusRequest({ ...request, targets: ["a".repeat(2000)] }), false);
});

test("an answer names its targets, one status for each", () => {
  const result = { type: "wikiLinkStatus", requestId: 3, targets: ["Home", "Missing"], statuses: [true, false] };
  assert.equal(isWikiLinkStatusResult(result), true);
  assert.equal(isWikiLinkStatusResult({ ...result, statuses: [true] }), false);
  assert.equal(isWikiLinkStatusResult({ ...result, targets: undefined }), false);
  assert.equal(isWikiLinkStatusResult({ ...result, statuses: [true, "no"] }), false);
});

test("a link stays dimmed between a change to the folder and the answer that follows it", () => {
  const answers = new WikiLinkAnswers();
  assert.equal(answers.unanswered("Ghost"), true);
  assert.equal(answers.missing("Ghost"), false, "a link nothing is known about is not dimmed");
  answers.ask(["Ghost", "Home", "Odd"]);
  assert.equal(answers.unanswered("Ghost"), false, "a path is asked about once");
  answers.apply(["Ghost", "Home", "Odd"], [false, true, null]);
  assert.equal(answers.missing("Ghost"), true);
  assert.equal(answers.missing("Home"), false);
  assert.equal(answers.missing("Odd"), false, "an unknown answer does not dim");
  assert.equal(answers.unanswered("Odd"), false);

  answers.invalidate();
  assert.equal(answers.missing("Ghost"), true, "the earlier answer is still painted");
  assert.equal(answers.missing("Home"), false);
  assert.equal(answers.unanswered("Ghost"), true, "and every path is asked about again");
  assert.equal(answers.unanswered("Odd"), true, "also one the host could not tell before");

  answers.ask(["Ghost"]);
  answers.apply(["Ghost"], [true]);
  assert.equal(answers.missing("Ghost"), false, "the new answer replaces the earlier one");
  answers.invalidate();
  assert.equal(answers.missing("Ghost"), false);
});

test("the answers one editor keeps are bounded", () => {
  const answers = new WikiLinkAnswers();
  for (let round = 0; round < 3; round++) {
    const targets = Array.from({ length: 1500 }, (_, index) => `note ${round}-${index}`);
    answers.ask(targets);
    answers.apply(targets, targets.map(() => false));
    answers.invalidate();
  }
  // Nothing grows without limit; an early path is simply asked about again.
  assert.equal(answers.unanswered("note 0-0"), true);
  assert.equal(answers.missing("note 2-0"), true);
});
