@AGENTS.md

# Claude Code adapter

AGENTS.md owns the shared repository rules. Keep this adapter short; do not maintain a second
copy of the architecture, the command list, the decisions or the invariants here.

- Load context through the routing table in AGENTS.md; do not read every document for a small
  task. `src/extension.ts`, `src/webview/liveEditor.ts` and `scripts/edh-visual-check.mjs` are
  large: search them and read the part you need.
- Project skills in `.claude/skills/` hold the repeatable workflows: `verify-change`,
  `session-journal`, `update-docs` and `add-dependency`. Use them at the moments their
  descriptions name. `invariant-reviewer` is the read-only review subagent. See
  [.claude/README.md](.claude/README.md).
- The repository is public. What is said in a conversation stays in the conversation: write
  decisions into files as facts about the project, never as quotations or as an account of who
  asked for what. This applies to journals, registers, reports, code comments and commit
  messages alike.
- When an open question in DECISIONS blocks the work, ask it directly: one decision per
  question, the recommended option first. Record the outcome as a fact with its date, and never
  ask it again.
- Use plan mode for substantial or ambiguous work; proceed directly on small approved changes.
- Screenshots are evidence only when you opened them. Read the PNG files the host checks save in
  `qa/` with the Read tool before describing what the editor looks like. They show local paths,
  so they are never committed and their paths are never copied into a document.
- The host checks open a VS Code window on the desktop and take the foreground for up to two
  minutes. Run them when the change needs them, one at a time.
- Keep durable project facts in the versioned documents. Personal auto-memory is not a substitute
  for accepted decisions, PROGRESS or verification evidence.
- Keep permission protections enabled. Never enable a bypass mode to work around a failed action.
- Add a project hook, skill or subagent only for a demonstrated, repeated need, and test it
  first. Do not install global settings, MCP servers or integrations as a side effect of repo work.
- Run `npm run check:docs` and `npm run check:privacy` after editing documentation; the Stop
  hook enforces both.
- Checkpoint the session journal as the work happens. Hooks measure context use and say when a
  checkpoint is due; act on it only if something meaningful is unrecorded. After compaction the
  journal's state is re-injected; where it and the summary disagree, check the transcript.

The explicit import works on Windows without symlinks and in sessions where native AGENTS.md
loading is unavailable. See [research and sources](docs/RESEARCH.md).
