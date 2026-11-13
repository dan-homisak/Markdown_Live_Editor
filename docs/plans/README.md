# Plans

Create one short plan here for work that spans sessions: a feature, a spec revision, a refactor
of the edit path. Routine fixes need no plan. Name files `YYYY-MM-DD-short-topic.md`. Mark a plan
complete or delete it when its work lands; PROGRESS keeps the durable record.

## Template

```markdown
# <Outcome in one line>

Status: active | blocked | complete. Owner approval: <decision IDs or "not needed">.

## Outcome and acceptance
- What will be observably true, and where it is documented (spec section, README passage).

## Decisions and open questions
- Accepted decisions relied on; open questions that could change the work.

## Affected surfaces
- Host, webview, tables, preview, settings, package, fixtures.

## Test cases
- Tests to write first; host script cases; screenshots to inspect; measurements to record.

## Steps
1. ...

## Risks
- Which invariant this could break, and how we would notice.

## Evidence so far
- Date, command or measurement, result, environment, extension version.
```
