# Run log template

Copy this into `.agents/unattended/<run>/log.md`. Someone who has only this file must be able to tell where the run is and what it does next.

```markdown
# <run name>

Brief: <path to the prompt or brief, or "inline in the thread" plus a one-line summary>
Started: <time> · Base: <full SHA> (<base ref>)
Authorized outward actions: <exactly what the brief allows, or "none">
Budget: <the measure> · soft <limit> · hard <limit>

## Next action
<one line: what the run does next. Rewrite it after every step.>

## Items
| Item | Branch | Status | Head SHA |
| --- | --- | --- | --- |
| 1. <name> | `<branch>` | done / in progress / WIP / skipped | <full SHA> |

## Checks
- <item> · `<exact command>` · <the deciding output line> · at <SHA>

## Budget readings
- <time> · <reading> · <what it allowed>

## Decided for you
- <decision>: <why it was safe and reversible, and how to undo it>

## Needs you
- Decide / Review / Do: <the exact thing> · <why it was skipped>

## Notes
- <anything a restarted run must know: a flaky test, a path that turned out wrong>
```

Rules for the log:

- Full SHAs, literal branch names and absolute paths, so nothing needs the conversation to resolve.
- Record a check's command and its output line, not "passed".
- A skipped item says why, and what would unblock it.
- No secrets or tokens, even in a command line.
