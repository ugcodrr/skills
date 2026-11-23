# Correctness reviewer prompt

Fill every `<…>` and send it as the reviewer's task, with worktree isolation. Give the purpose and the code, not your hunches: a reviewer handed a suspicion tends to confirm it.

```
Read-only correctness review of <"PR #<n> (<title>) in <owner/repo>" | "local branch <branch>, PR <k> of <n> in <stack>: <title>">. Head <head SHA>, base <base> (merge base <merge-base SHA>).

What the change is meant to do, from its description:

<the description, without image blocks>

Owner decisions, which settle what's intended: <decisions, or "none">.

Scope: <"the whole change" | "only <reviewed SHA>..<head SHA>; the earlier diff had this review on <date>, see <record path>">.

Proof already on record, so spend your time on what it doesn't cover: <test runs, output comparisons or renders from the ledger or reports, or "none">.

Setup: <for a PR: git fetch <remote> pull/<n>/head <base> && git switch --detach <head SHA> | for a local branch: git switch --detach <head SHA>>. Install dependencies only if you need to run the type checker or tests. Read the diff in scope and the code around every changed line, including callers and callees.

Find bugs only. Each finding needs file:line, a concrete input or state, the wrong result it produces, and the code that proves it. Leave out style, naming, structure, tests and the description. Say when a problem was already on the base rather than added by this change. Before calling anything unused, search for its callers and dynamic uses.

Rules: don't commit, push, comment on or post anything. Don't start servers, bots, containers or anything that talks to production, don't open or print secrets or local config, and don't call paid or rate-limited APIs. Reading code, the type checker, the test suite and small offline scripts are fine. Never end your turn while a command is still running in the background.

Return:
Outcome: <PR #<n> | <branch>>: <k> bugs | none found
Then one block per finding: severity (high/medium/low), file:line, input or state, wrong result, evidence, added by this change or pre-existing.
Unchecked: anything you couldn't check, and why.
```

For a change under about 30 changed lines, skip this reviewer and add one line to the cleanup reviewer's brief instead: "Also check for bugs: file:line, a concrete input or state, and the wrong result, with the code that proves it."
