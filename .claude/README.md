# Claude Code configuration

Project skills, hooks and a subagent for working on Markdown Live Editor with Claude Code. Shared
rules stay in [AGENTS.md](../AGENTS.md), and other agents follow the same practices by hand.
Adopted under decision A17. Everything here runs locally and makes no network calls. None of it
ships in the extension.

## Skills

| Skill | Use it | Invoked by |
| --- | --- | --- |
| [verify-change](skills/verify-change/SKILL.md) | Pick and run the checks a change needs, open the screenshots, install the build, report exact results | Claude, before calling a change done, or `/verify-change` |
| [session-journal](skills/session-journal/SKILL.md) | Record decisions, findings and task state in the session journal before compaction or a new chat loses them; `close` ends the session | Claude, at the triggers in [docs/sessions](../docs/sessions/README.md), or `/session-journal` |
| [update-docs](skills/update-docs/SKILL.md) | Bring the owning documents up to date and promote journal items | Claude, when finishing a change, or `/update-docs` |
| [add-dependency](skills/add-dependency/SKILL.md) | Approval, license, bundle and notices before a package is added, upgraded or removed | Claude, before any `npm install`, or `/add-dependency` |

## Hooks

Configured in [settings.json](settings.json); scripts in [hooks/](hooks/). They print only when
the model needs to know something, so they cost no tokens otherwise.

| Event | Script | Effect |
| --- | --- | --- |
| SessionStart | `session-journal.mjs session-start` | At startup, shows the latest open journal's "State now". After compaction, shows this session's journal state, direction not yet promoted, and the transcript path |
| UserPromptSubmit | `session-journal.mjs prompt` | Reads context size from the local transcript; one-line nudge when a checkpoint is due (every 10% of the compaction point, at least 40k tokens, since the last journal write) |
| PostToolUse | `session-journal.mjs post-tool` | Notes which journal this session just edited. Runs the same context check mid-turn, at most every 20 seconds; only the urgent nudge at 75% of the compaction point |
| PreCompact | `session-journal.mjs pre-compact` | Adds compaction instructions: keep IDs, files, commands, the installed version, commits and open tasks, and carry the conversation's own wording since the last checkpoint into the summary (up to 9,000 characters, newest kept), with a reminder that it never goes into a file |
| Stop | `stop-gate.mjs` | Runs the privacy check on every turn, and the documentation check when an agent document changed. If one fails, Claude has to fix it before finishing; it continues at most once per turn |

The compaction point comes from `CLAUDE_CODE_AUTO_COMPACT_WINDOW` when set, then from an earlier
compaction in the same session, then from the model (about 967k tokens for 1M-context models,
167k otherwise).

## Privacy

The repository is public (decision A18), and these tools are built around that.

- Hook state lives in `.local/agent/<session>.json`, which is ignored: token counts, times, and
  the path of the journal the session edited. No conversation text is stored.
- Journals carry no session identifiers. A session is linked to its journal by that local state.
- The exact wording of a conversation is passed only into the compaction summary, inside the
  running session. No hook writes it anywhere.
- `scripts/check-privacy.mjs` scans everything git would commit for home-directory paths and for
  the names in `.local/private-terms.txt`. That list is ignored too, so the names it guards are
  never published; a clone without the file checks paths only. Its output names the file and
  line, not the term.
- `scripts/check-docs.mjs` rejects quotation marks under a journal's "Direction", times of day
  and session identifiers in journals, and email addresses in agent documents.

## Subagent

[invariant-reviewer](agents/invariant-reviewer.md) reviews a diff against the AGENTS.md
invariants in a fresh context. It cannot edit files; [read-only-bash.mjs](hooks/read-only-bash.mjs)
limits its shell to read-only git commands and the documentation check. Use it when asked for a
review, or before committing changes to the edit path, table source protection, geometry, link
opening or the Content Security Policy.

## Test and troubleshoot

- `npm run test:agent` runs the hook tests with synthetic transcripts and the checker tests with
  synthetic projects.
- Run a hook by hand:
  `echo '{"session_id":"t","cwd":"."}' | node .claude/hooks/session-journal.mjs prompt`.
- `node scripts/check-docs.mjs --list` prints the documents the Stop hook watches. Samples,
  fixtures and the Markdown under `src/` are not among them.
- Hooks run only after the folder is trusted in Claude Code. To turn them off for one run, start
  Claude Code with `--settings '{"disableAllHooks": true}'`; to change them for yourself only,
  create `settings.local.json` in this folder (ignored).
- New skills are picked up on the next turn of the same session; a new `agents` folder loads at
  the next session start. Both were seen here on 2026-11-13.
- Status on 2026-11-13: tested by unit tests, by hand, and against a real session transcript.
  PostToolUse and UserPromptSubmit were seen firing in a live session. SessionStart, PreCompact
  and Stop have not been observed live yet; update this line when they are.
