---
name: receipts
description: Check every "done", "fixed", "passing", "verified" and "no change" claim in the current thread against real evidence from after the last change. It reruns the cheap checks (one test file, a typecheck, a grep, git state) and marks each claim proven (with the command and result), stale, unproven or false, quoting where it was made. Reports only, and fixes nothing unless asked. Use it for /receipts, "show me the receipts", "prove it", "is that actually fixed", "did you really run the tests", "check your claims", "are you sure it passes", "verify before I merge", and before handing back work that says it's done. Not for what's left before closing (use settle) or for reviewing a diff against the project's rules (use self-review).
---

# Receipts

Answer one question: which claims in this thread still hold right now, and what proves it? A claim counts only if a check after the last relevant change shows it. Report; don't fix.

## 1. Collect the claims

Read the whole thread, including subagent reports you passed on and anything you wrote for others: PR bodies (the Testing line), commit messages, report files.

A claim is any statement that something is true of the code or the world:

- **Results**: done, fixed, works, passing, green, clean, verified, tested.
- **Absence**: no change, identical, nothing else uses it, no regressions, safe to delete.
- **State**: committed, pushed, merged, up to date, CI passes.
- **Numbers**: a timing, a count, a size, a percentage.

Quote each one in a few words and say where it was made: which reply ("the reply after the lint fix"), which report, which file.

## 2. Find what each claim depends on, and when that last changed

Name the files, branch or remote state each claim covers. Then find the last change to them:

- edits later in the thread, and `git status --short` for uncommitted ones;
- `git log -1 --format='%h %s' -- <paths>`;
- a rebase, merge, dependency bump or config change since the claim.

A claim made before a later change to what it covers can't stand on its old evidence.

## 3. Rerun the cheap checks

Cheap means under about a minute and no side effects: one test file or a filtered run, a typecheck, lint on the changed files, a grep, `git status`, `git log`, `git ls-remote`, `gh pr view --json`. Take the commands from the project (AGENTS.md, CLAUDE.md, package.json scripts, the Makefile). Run each once, and keep the exact command and the line of output that decides it.

- **A pass has to show work.** Exit 0 with "0 tests" or "no files matched" proves nothing. Check the count.
- **An absence needs a comparison**: a diff, a grep for other callers, before and after output. "No change" with nothing compared is unproven.
- **Someone else's word isn't a receipt.** A subagent's "tests pass" is unproven until you've seen the output.
- **Don't run** full suites, builds over a minute, deploys, or anything that writes, posts or calls production. Name the command that would settle it instead.

## 4. Mark each claim

- **Proven**: a check you ran just now, after the last change, shows it.
- **Stale**: it was shown once, but what it covers changed after, and the recheck is too slow to run now.
- **Unproven**: nothing has ever shown it, or showing it needs a check you can't run here (a device, a manual look, production).
- **False**: a check shows the opposite.

## Report

The first line is the tally. Then False, Stale, Unproven and Proven, worst first, skipping empty ones. One line each: the quote, where it was made, then the evidence.

```
Receipts: 6 claims, 3 proven, 1 stale, 1 unproven, 1 false.

False
- "pushed to origin" (the reply after the rebase): `git ls-remote --heads origin fix/retry` shows 8d1e0f2, local HEAD is 3f9c2e1. Two commits not pushed.

Stale
- "full suite passes" (PR #131's Testing line): passed at 8d1e0f2, then src/queue.ts changed in 3f9c2e1. `npm test` takes about 6 minutes, not rerun.

Unproven
- "the retry banner looks right on mobile" (the subagent's report): no screenshot or device check ever ran.

Proven
- "typecheck is clean": `npm run typecheck` exit 0, "Found 0 errors", at 3f9c2e1.
- "webhook tests pass": `npx vitest run src/webhooks` "12 passed" at 3f9c2e1.
- "nothing else calls parseRetry": `rg -n 'parseRetry\(' src` finds only src/queue.ts:18 and its test.
```

After the report:

- Name any artifact that repeats a false or stale claim (a PR body, a commit message, a report), so the user knows what to correct.
- If the user asks you to fix things, fix the false ones first, then run receipts again so the tally is current.
