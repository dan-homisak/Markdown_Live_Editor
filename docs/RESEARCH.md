# Research basis and adopted practices

Compiled 2026-11-13. A record of where this repository's agent guidance came from and how far
each part has been checked here. It is not a measured comparison of tools. Primary documentation
decides tool behavior; recheck sources when relying on a detail, because pages change.

## Predecessor framework

The agent workflow here (decision A17) was adapted from an existing framework in a private
project, which is not named or described in this public repository. Its structure was adopted
and its content rewritten for this project.

| Adopted | Changed for Markdown Live Editor |
| --- | --- |
| AGENTS.md owns shared rules; CLAUDE.md imports it with a short Claude adapter | Rules rewritten around source integrity, the host edit path, table ownership, stock-editor geometry and packaging. The four standing rules of the earlier instruction file are kept as decisions A01-A04 |
| A routing table, so agents load only the documents a task needs | Routes to the README, the design spec and a dedicated test plan |
| Decision register with accepted, proposed and not-selected entries and stable IDs; a recommendation is never presented as approval | No register existed, so accepted entries were reconstructed from the repository record and say so. Open questions live in the same file |
| Flag disagreements between intended and implemented behavior instead of silently rewriting either | The disagreements found here were first recorded as an open question, then resolved by decision A20 |
| Work in verifiable increments; failing test first; honest reporting; a failing baseline needs evidence | A baseline of the unchanged product was run before anything changed, and suites found failing were reproduced on an untouched copy of the last commit before being called pre-existing |
| A commands table of what works today | Enforced mechanically: the documentation checker fails when an agent document names an npm script or repository path that does not exist |
| Non-negotiable invariants in the root file | Derived from the spec, the README and the code paths that enforce them |
| Verification matrix by change type | Became a full test plan in [TESTING](TESTING.md), with the status of every suite |
| Session journals, with hooks that measure context, protect exact wording at compaction and re-inject state afterwards | Rewritten for a public repository (A18): journals hold no quotations, times of day or session identifiers, and the link between a session and its journal is kept in local state |
| Stop hook that runs the documentation check when documents changed | Also runs a privacy check on every turn |
| Read-only reviewer subagent with a shell guard | Review list rewritten for this project's failure classes |
| Skills for journaling, updating documents, verifying a change and reviewing a dependency | Rewritten for this project's checks and build |
| Dependency-free documentation checker with tests | Scoped to agent documents, so samples and fixtures are never touched. Checks added for stale commands and paths and for the size of AGENTS.md |
| When an agent repeats a mistake, prefer a test or a checked script; add a hook or skill only for a demonstrated need, and test it | Kept as a rule in ENGINEERING and the Claude adapter. Applied three times so far: stale commands and paths, fixture changes, private details |
| PROGRESS as the record of actual state, with exact evidence and what was not run | Kept |

| Not adopted | Reason |
| --- | --- |
| Separate product, data-model, security, stack and operations documents | This is a shipped editor extension whose contract fits in a README and a design spec |
| Acceptance-criteria IDs | The spec's regression table and the test plan cover it; a third list would drift |
| A discovery skill and a separate agenda of open questions | No discovery phase here. Its rule survives in the Claude adapter: one decision per question, recommendation first, the outcome recorded and never asked again |
| A single-branch rule | Not assumed; it is question Q03 |
| Verbatim quotation of direction in journals and registers | The repository is public (A18) |
| A repository-wide `.editorconfig` and LF normalization for every file | Unsafe here: trailing spaces are meaningful Markdown and the line-ending tests need both forms. Only agent documents and fixtures are pinned to LF |
| Browser-pane verification probes | This product renders inside VS Code; its checks drive Electron through the debugging port |

## Agent workflow sources

Carried from the predecessor's research record, which reviewed them on 2026-10-29 and
2026-11-09. They were **not fetched again** for this repository. They support the shape of
AGENTS.md, CLAUDE.md, ENGINEERING and the files in `.claude/`.

| Source | Practice adopted |
| --- | --- |
| [Anthropic: Claude Code best practices](https://code.claude.com/docs/en/best-practices) | Instructions give context for decisions; tests, checks and permissions provide enforcement |
| [Anthropic: memory and instruction files](https://code.claude.com/docs/en/memory) | CLAUDE.md imports AGENTS.md instead of duplicating it. Auto memory lives outside the repository, so durable facts go in committed documents |
| [Anthropic: effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents) | Incremental slices, progress records and end-to-end evidence |
| [OpenAI: AGENTS.md custom instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | One shared root file; scoped files only when needed |
| [Simon Willison: red/green TDD](https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/) | Observe a test fail before trusting it to pass |
| [Mitchell Hashimoto: My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey) | Turn repeated agent mistakes into checks |
| [Birgitta Boeckeler: harness engineering](https://martinfowler.com/articles/harness-engineering.html) | Confidence comes from feedback loops, not prompts |
| [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) | PreCompact output becomes summary instructions; SessionStart and UserPromptSubmit output is added to context; Stop can block once; the exec form with `${CLAUDE_PROJECT_DIR}` needs no shell, which suits Windows |
| [Claude Code skills](https://code.claude.com/docs/en/skills) | Project skills under `.claude/skills/`; descriptions are always in context and cut at 1,536 characters; bodies stay under 500 lines |
| [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | A `tools` allowlist and scoped hooks make the reviewer read-only |
| [Context window and compaction](https://code.claude.com/docs/en/context-window), [model configuration](https://code.claude.com/docs/en/model-config) | What survives compaction, and the token counts the hooks use to estimate when it happens |

## Local evidence (2026-11-13)

| Evidence | Finding | Consequence |
| --- | --- | --- |
| On a Windows checkout with automatic line-ending conversion, 128 tracked text files have CRLF | A checker that rejects CR everywhere, or a hook that anchors patterns at line ends, would fail on a fresh Windows clone | `.gitattributes` pins agent documents and fixtures to LF; hooks read CRLF as LF |
| `git ls-files` lists `media/liveEditor.js`; `npm run compile` on an unchanged tree leaves `git status` clean | The bundle is a tracked, reproducible build output | AGENTS.md says to commit it with the source change |
| `Build_and_Install.cmd` ends with `pause` unless `MLRT_NO_PAUSE` is `1` | An agent's shell would wait for a key forever | AGENTS.md names the variable and the direct Node entry |
| Three of the seven Markdown documents at the repository root were read by no test or script; the other four were read by tests | Editing a document by hand could change what a test exercised | Fixtures and samples are separate folders (A21) |
| The package listing before the cleanup: 222 files | Development files were shipping | The package is built from an allowlist |
| The Live Preview host suites, run on an untouched copy of the last commit | They fail there too | Their status is recorded in TESTING and the repair is proposal P07 |
| The hooks, run against a real session transcript and observed in a live session | The compaction hook reproduced only genuine messages; the tool and prompt hooks were seen firing | See [.claude/README.md](../.claude/README.md) |

## Synthesis, not source claims

Which practices fit an editor extension, the wording of the invariants, the privacy rules and
how they are checked, the scope of the documentation checker and the line budget for AGENTS.md
are judgments made while setting this up. No tool's documentation establishes them.
