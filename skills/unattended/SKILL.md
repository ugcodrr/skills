---
name: unattended
description: Rules for a run nobody watches. It checks the brief before launch, then asks nothing, commits only to local branches, pushes, posts or deletes only what the brief authorized, and ends with "Decided for you" and "Needs you". Use it for "run this overnight", "while I'm away", "keep going until the tests pass", "work through the backlog", "I'll check in the morning", scheduled tasks, /loop, and when writing or reviewing such a run's prompt. Not for the morning pass over every thread (use inbox).
---

# Unattended

A run nobody watches has to finish on its own, leave nothing it can't undo, and hand back a report the user can act on in two minutes. These rules hold for the whole run, whatever the brief's task is. Two come first: ask nothing, and take no outward action (a push, a post, a delete) that the brief didn't name exactly.

## 1. Before launch: check the brief

Do this when writing or reviewing a run's prompt, and again as the run's first step. While the user is still around, fix gaps with them. Once they're gone, log the gap and take the safest reading.

1. **Pin the base.** Record the full SHA the run starts from (`git rev-parse <base>`). Check every file, symbol and line the brief cites at that SHA (`git show <sha>:<path>`), not from memory. If the base moved after the brief was written, recheck before building on it.
2. **Name what it touches**: exact paths and branch names. List the open PRs that touch those paths with `gh pr list --state open --json number,title,files,changedFiles`. `files` stops at 100, so when `changedFiles` is bigger, page that PR with `gh api repos/<owner>/<repo>/pulls/<n>/files --paginate`. Note other threads or runs working there. If a PR already does an item, skip that item.
3. **Write the exact verify commands** and what each must print to count as a pass ("exit 0 and `14 passed`", not "tests pass"). Keep the project's own limits, such as concurrency caps from its instructions.
4. **Read the gates together.** Authorization, budget thresholds and fallback order must not contradict each other, like a preflight stop that blocks a later fallback, or "stop by 06:00" in one place and "stop by 07:00" in another. Say what happens exactly at each boundary (does a limit of 20 attempts allow the twentieth?), and that a failed reading counts as over.
5. **Spell out each outward action** the run may take, with its target: "push `fix/retry-cap` to origin and open it as a draft PR". Anything not named isn't authorized. Drafts (PR bodies, messages) exist as files before any review, and a push names the SHA its checks passed on.
6. **Name the stop conditions and the budget**, and what happens to the item in hand when one hits.

Defaults that recur across runs (the budget reading, verify commands, off-limits paths) can live in `.agents/unattended.md` in the project, or `~/.agents/unattended.md` for every project. `references/unattended.example.md` is a filled-in one. The brief wins where they differ.

## 2. During the run

- **Ask nothing.** If the code or docs answer it, decide it. If the recommended option is safe and reversible (a local commit, a new branch, a file in the run folder), take it and log it under Decided for you. If it isn't (it publishes, deletes, overwrites someone's work, spends money, or changes what ships beyond the brief), skip it and log it under Needs you. Never stall waiting for an answer.
- **Keep the log.** Write `.agents/unattended/<run>/log.md` in the main checkout (the first path `git worktree list` prints), so it outlives the run's worktree. Start it from `references/log-template.md` before the first change. Update it after every step, next action included, so a compacted or restarted run can carry on from the log alone. Keep the folder out of git with a `.gitignore` of `*` inside it, unless the project says otherwise.
- **Git stays local.** One branch per item, cut from the pinned base, committing as you go in the project's commit style. Never push, force-push, rewrite a shared branch, delete a branch, remove a worktree or commit to the default branch, unless the brief authorized exactly that. When it did, check the remote right before (`git ls-remote --heads <remote> <branch>`), push only the SHA that passed every check, and never force.
- **Commit, never stash.** Unfinished work goes on its branch as a commit marked WIP in the log. Every worktree shares one stash list, and stashes are easy to lose.
- **Post nothing.** No comments, reviews, labels, issue edits or messages unless the brief names that exact action.
- **Stay in your lane.** Don't touch paths, branches or worktrees another thread or run owns. If the run's own worktree has changes you didn't make, someone else is working there, so stop the run. In a checkout the brief says other threads share, check that `git diff --cached` is empty, then commit only your own paths (`git commit -m <message> -- <paths>`).
- **Long jobs** run in the background, and you wait on them rather than polling. Give every probe or script you start a timeout, so one hang can't eat the run.
- **Read the budget** before each new item and after each expensive step (a full build, a full test run, a review). Use the brief's measure: a usage command, an end time, or an item or attempt count. At the soft limit, start nothing new, and finish and commit the item in hand. At the hard limit, stop building and go to step 3. A failed reading counts as the hard limit.
- **Don't loop.** The same failure twice with the same approach ends that item: log it under Needs you and move on. "Keep going until X" needs X to be a command that can say yes, plus a cap on attempts.

## 3. Stop

Stop the run when any of these is true:

- the brief's goal check prints what it must
- the hard budget limit hits
- a preflight gate fails (base missing, duplicate work found, verify can't run)
- going on would need an action the brief didn't authorize

Then commit what's done, finish the log, and write the report.

## 4. Report

Under about 25 lines. Lead with what's done and where it lives. Every item names its branch and SHA, PR or file. Leave out passing checks unless they're the proof of an item, and leave out the story of the run. End with why it stopped, the log's path and the settle verdict (the `settle` skill, if installed; otherwise list each branch with unpushed commits and any uncommitted work).

```
Overnight run: 2 of 3 items done on local branches. Nothing pushed (the brief didn't authorize it).

Done
- `fix/retry-cap` 3f9c2e1a7b: retries stop after 5 attempts. `npx vitest run src/webhooks`: 14 passed.
- `test/backoff-helper` 8d1e0f2c44: tests for the backoff math. `npx vitest run src/queue`: 9 passed.

Decided for you
- Backoff cap of 30s, matching the HTTP client's timeout (src/http.ts:12). One constant to change.
- Reused the backoff helper in src/util/backoff.ts instead of adding a second one.

Needs you
- Decide: item 3 removes the public /v1/hooks route. Skipped, since it deletes an API. Recommended: deprecate it first.
- Do: push both branches and open PRs. Bodies are drafted in .agents/unattended/webhooks/drafts/.
- Review: `fix/retry-cap` conflicts with #131 in src/queue.ts (`git merge-tree`). Whichever lands second resolves it.

Stopped at the hard budget limit after item 2 (20 of 20 build attempts).
Log: ~/src/acme-api/.agents/unattended/webhooks/log.md
Settle: not safe. 2 branches have unpushed commits.
```
