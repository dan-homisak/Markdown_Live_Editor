# Session journals

A session journal keeps what an agent needs to continue the work: decisions, findings and task
state, written as the work happens so that context compaction, a new chat or another agent loses
nothing important. It is a staging area. Durable facts move to the document that owns them
(DECISIONS, TESTING, ENGINEERING, ARCHITECTURE, PROGRESS, the spec, the README), and the journal
points there. It never replaces keeping those documents current.

## This is a public file

Journals are committed to a public repository. They describe the project, never the person.

- **No quotations.** Restate direction as a fact about the project: "raw run output is not kept
  in version control", not who asked for it or in what words.
- **Nothing about how the work is done**: no time of day, no schedule, no tools or habits, no
  other projects, no opinions, no account of a conversation.
- **No identifiers**: no session or account IDs, user or machine names, email addresses or
  absolute paths.
- No transcripts, tool output or private reasoning.

The documentation checker rejects quotation marks under "Direction", times of day in headings
and the header, and session identifiers. Which journal belongs to which session is remembered
only in local hook state under `.local/`, which is ignored.

## When to write a checkpoint

Write one when something meaningful happened that is not yet recorded anywhere:

- A decision, an answer to an open question, a correction or a stated preference.
- A milestone, a commit, an installed version, or a finding that changes the plan.
- Before a long autonomous task, and when a hook reports that a checkpoint is due.
- At the end of the session (close it).

Skip it when nothing new happened. In Claude Code the `session-journal` skill does this, and hooks
measure context use and re-inject the journal after compaction (see
[.claude/README.md](../../.claude/README.md)). Other agents follow the same format by hand.

## Format

One file per session: `YYYY-MM-DD-<topic>.md`, named for the day the session started.

```markdown
# Session 2026-11-13: <topic>

Status: open · Updated: 2026-11-13

## State now

- Working on: <task>
- Next step: <the next concrete action>
- Waiting on a decision: <the open question, by ID, or "nothing">
- Uncommitted: <summary of the working tree, or "clean">
- Installed: <extension version>

## Direction

- 2026-11-13, pending: <what was decided, as a fact about the project>
- 2026-11-13 → A21: <the same, once it is recorded in DECISIONS>

## Checkpoints

### 1. <short title>

- Decided: <what, with IDs>
- Learned: <fact that changes the work>
- Rejected: <option, and why>
- Checks: <commands with exact results>
- Open: <question still unanswered>
```

- **Header:** `Status` is `open` or `closed`; `Updated` is a date.
- **State now** is rewritten at every checkpoint and stays under 15 lines. Hooks show it at the
  start of the next session and after compaction.
- **Direction** lists decisions that came from outside the agent, each restated as a fact. An
  item says `pending` until it is promoted, then `→` and where it went (an ID or a document).
- **Checkpoints** are numbered, short and append-only. Use only the labels that apply. Mark an
  agent's own choices "Decided (agent)".

## Rules

- Keep the whole file under 200 lines. When it grows, condense older checkpoints into a line or
  two each.
- Record what would be lost otherwise. Link to documents, IDs and commits instead of repeating
  them.
- Closing a session: promote every pending item, update PROGRESS if a milestone was reached, then
  set `Status: closed`.
