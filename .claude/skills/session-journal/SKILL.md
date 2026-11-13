---
name: session-journal
description: Record what matters from this session in the session journal (docs/sessions) before compaction or a new chat loses it - decisions, findings and task state, written as facts about the project and never as quotations. Use after a decision, answer, correction or stated preference; after a milestone, commit or install; before a long autonomous task; when a hook says a checkpoint is due; and with "close" at the end of a session. Skip when nothing new happened.
argument-hint: "[close]"
---

# Session journal checkpoint

Journal format and rules: `docs/sessions/README.md` (read it once per session if you have not).

## This file is public

The journal is committed to a public repository. Before writing a line, apply "Public
repository" in `AGENTS.md`:

- Never quote or closely paraphrase a message. Restate what was decided as a fact about the
  project: "the package is built from an allowlist", not who wanted it or how they said it.
- Nothing about how, when or with what the work is done; no other projects; no opinions.
- No times of day, session or account identifiers, user or machine names, absolute paths.

When a detail is useful to the agent but says something about the person, leave it out.

## First decide whether there is anything to record

Record only what would be lost if this conversation were compacted now and is not already in a
project document or a commit. If nothing qualifies, stop; do not mention the checkpoint.

Worth recording, most important first:

1. **Decisions and direction**, restated as project facts, with the date, and with their IDs
   once they are in `docs/DECISIONS.md`.
2. **Options rejected**, with the reason.
3. **Findings that change the plan**: a constraint, a failed approach, a measured number, a
   screenshot that showed something the script did not.
4. **Task state**: what is in progress, the next concrete step, which open question blocks,
   uncommitted work, the installed extension version.

Not worth recording: tool output, routine steps, file contents, private reasoning, anything a
document or commit already says (link to it instead).

## Steps

1. Find the journal: the one you already edited in this session; otherwise the latest open
   journal in `docs/sessions/` if it covers the same work; otherwise create
   `docs/sessions/YYYY-MM-DD-<topic>.md` (the session's start date) from the README template.
2. Edit the journal in place with the Edit tool, so the hooks can link it to this session:
   - Rewrite **State now** (under 15 lines).
   - Add new direction under **Direction**, marked `pending`, with no quotation marks.
   - Append one numbered entry under **Checkpoints** (at most 10 lines).
   - Set `Updated:` in the header to today's date.
3. Promote when it is cheap: if an item clearly belongs in a project document and the edit is
   small, apply the `update-docs` skill now and mark the item `→ <ID or document>`. Otherwise
   leave it `pending`.
4. If the journal passes 200 lines, condense the oldest checkpoints to a line or two each.
5. Mention a routine checkpoint in at most one short clause of your reply.

## Close the session (`/session-journal close`)

Write a final checkpoint. Promote every pending item with `update-docs`, or say in State now why
it stays open. If a milestone was reached, make sure PROGRESS records it. Then set
`Status: closed`.
