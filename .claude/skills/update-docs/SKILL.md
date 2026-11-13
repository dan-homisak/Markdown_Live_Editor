---
name: update-docs
description: Bring Markdown Live Editor's project documents up to date after work changes what they should say - a decision or an answered question, user-visible behavior, a setting, a command, a dependency, the code map, a suite's status, a milestone with evidence - and promote pending items from the session journal. Use as part of finishing a change, before reporting it done.
---

# Update the project documents

## Where each fact lives

One document owns each fact; others link to it instead of repeating it.

| Fact | Owning document |
| --- | --- |
| Something decided or approved | `docs/DECISIONS.md`: an accepted `A##` row stating the fact and its date |
| An agent's recommendation | `docs/DECISIONS.md`: a proposed `P##` row; rejected options under "Not selected" |
| A question that needs an answer | `docs/DECISIONS.md`: an open `Q##` row; when answered, the outcome and date go in its Notes and an `A##` row is added |
| User-visible behavior, settings, shortcuts | `README.md`, written for the public |
| The rendering and editing model | `docs/DESIGN_SPEC.md` |
| Where code lives, the message protocol, the edit path | `docs/ARCHITECTURE.md` |
| Which suite covers what, what a change must run, each suite's status | `docs/TESTING.md` |
| Workflow, visual-parity notes, lessons learned, review priorities | `docs/ENGINEERING.md` |
| Sources consulted and what was adopted from them | `docs/RESEARCH.md` |
| Repository state, milestone evidence, known gaps, next steps | `docs/PROGRESS.md` |
| Shared agent rules, working commands, invariants | `AGENTS.md` (CLAUDE.md only for Claude-specific notes) |
| Bundled third-party licenses | `THIRD_PARTY_NOTICES.md`, through `scripts/record-markdown-bundle-impact.mjs` |
| An investigation worth keeping | A dated report in `docs/reports/`, linked from PROGRESS |
| Session state and direction not yet promoted | The session journal in `docs/sessions/` |

## Rules

- **The repository is public.** Follow "Public repository" in `AGENTS.md` in every document and
  commit message: state facts about the project; never quote or describe a request, never say
  how the work is done, never include personal identifiers or absolute paths.
- **Accepted only when it was decided.** A recommendation stays proposed (`P##`) or open
  (`Q##`); never present it as approved. When an agent acted on its own judgment under a general
  decision, say so in the Notes.
- **IDs:** take the next free number in the family; never reuse or renumber. Mark a replaced
  entry "superseded by" its successor; an answered question keeps its row.
- **Change the owner first**, then update mentions and links elsewhere. Do not copy paragraphs
  between documents.
- **Behavior and its documents change together.** A behavior change that leaves the README or
  the spec describing the old behavior is unfinished.
- **A suite's status is a fact.** When a host suite starts or stops passing, update the status
  table in `docs/TESTING.md` in the same change.
- Update the `Updated:` line of each document you change.
- **Evidence is exact:** commands, counts, exit codes, dates, the extension version. Say which
  checks were not run. Never invent results.
- Prefer editing an existing line to adding a paragraph. Remove guidance that became wrong.
- Keep AGENTS.md within its line budget; detail belongs in `docs/`.
- Dated reports are records. Do not rewrite their findings; add a new report instead.

## Steps

1. List what changed that a document should now say: this session's work, and the `pending`
   items under Direction in the session journal.
2. Edit each owning document from the table, smallest correct change first.
3. Mark promoted journal items `→ <ID or document>`.
4. Run `node scripts/check-docs.mjs` and `node scripts/check-privacy.mjs` and fix every problem
   they report. The first also fails when a document names an npm script or a repository path
   that no longer exists.
5. Name the documents you changed in one line of your reply.
