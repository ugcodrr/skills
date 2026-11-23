---
name: perf-review
description: Code-reading performance review against an eleven-point checklist (sequential work that could run concurrently, concurrency limits, extra passes, allocations, batch sizes, batching versus streaming, work during an await, early exits, threads, data structures, I/O call counts). It ranks findings by the estimated win of the best sound fix, judged against the project's production load and limits, shows effort beside it, checks every finding against earlier reports and open PRs so nothing is duplicated, and builds PRs only for the findings the user signs off on. Use it for a "perf review", "performance audit", "optimization pass", "low-hanging fruit", "make X faster", "why is X slow", or to run the perf checklist over a folder, endpoint, command or PR. Not for measuring a change you already made (use diff-proof) or a general code review (use self-review).
---

# Perf review

Find the performance wins worth a PR in this codebase, prove each one from the code, and rank them by what they'd actually save in production. You're the lead: reviewers read code and return findings, you check every finding yourself, drop the duplicates, rank and report. You build PRs only for the findings the user picks.

Before you start, read `references/checklist.md` (the eleven questions, floors and sizing) and the project's context file.

## The context decides the win

The same N+1 query is worth a PR on a saturated database and nothing on an idle one. The context lives in `.agents/perf-review.md` in the project: the machine, production load, hard limits (rate-limited upstreams, connection caps), hot paths, reviewer areas, and what's already covered or dismissed. `references/perf-review.md` is a filled-in example.

When the file doesn't exist, ask the user for those numbers once, in one batch, and offer to write the file from their answers. If they don't have them, or the run is unattended, estimate frequencies from the code, mark every win "assumes <what you assumed>", and say so at the top of the report.

## Limits

- Phases 1 to 4 are read-only: no edits, no services started, no calls to external services, no benchmarks unless the user asks.
- Phase 5 changes code only for the picks: one branch per finding, committed locally. Push and open a PR only after the user signs off on that pick.
- Never commit to the default branch, touch tags, or push to, comment on or close anyone else's PR.
- A change to responses, stored data, ordering, user-visible behavior or a new dependency needs the user's OK. Mark it "needs OK" in the report instead of ranking it lower.

## Phase 1: scope

1. Use the context file's areas. Without them, split by the top-level folders that hold hot paths, and skip vendored, generated and test code.
2. A narrower ask (one folder, one endpoint, one PR's diff) gets one reviewer on just that.
3. Review the tip of the default branch (`git fetch` first) and note its commit in the report, since line numbers go stale. For a PR, review its head.

## Phase 2: review

Start one reviewer per area, all at once: several Agent calls in one message in Claude Code, `delegate_task` in T3 Code. Without subagents, do the areas yourself one at a time. Fill in `references/reviewer-prompt.md` for each.

## Phase 3: verify and dedupe

1. Open every cited file:line yourself. Drop a finding when the code doesn't do what the reviewer says, the path is cold, or the estimate is under the checklist's floors. Reviewers sound just as confident when they're wrong.
2. Known: match each finding against the context file's covered and dismissed lists and the earlier reports in `.agents/perf-review/`. Mark it "known (P3)" or "PR #123".
3. Open PRs: run `node <this skill's folder>/scripts/open-prs-touching.mjs <file>...` on each finding's files. It pages past `gh`'s 100-file cap. Exit 2 or an `incomplete:` line means a PR's files couldn't all be read, so those files aren't cleared yet.
4. Closed attempts: `gh pr list --state all --search "<keywords>"`. A closed PR often says why the idea was turned down.
5. An open PR on the same lines with the same intent is a duplicate. One on the same file with another concern is a conflict note.

## Phase 4: report

Write `.agents/perf-review/<YYYY-MM-DD>.md`:

- the commit, the scope, the reviewers, and whether the context file existed;
- new findings ranked by the estimated win of the best sound fix and the strength of its evidence, in a table: #, question, finding, file:line, path and frequency, est. win, effort, risk, output change, status. Effort is a column, never the ranking;
- a short section per finding: what happens now, the change, and the arithmetic;
- known items, with anything new learned about them;
- "checked, clean" per question, and what couldn't be checked.

`.agents/perf-review/` is the record later runs dedupe against. Keep it out of git (a `.gitignore` of `*` inside it) unless the repo is private and the team wants the history, since reports quote production numbers.

In chat, give the top picks in 15 lines or fewer:

```
Perf review of acme/api at 1a2b3c4 (origin/main): 3 areas, 6 new findings, 2 known.
Report: .agents/perf-review/2026-01-15.md

| # | Finding | Where | Est. win | Effort | Output |
|---|---|---|---|---|---|
| 1 | Partner price calls run one cart item at a time | src/pricing/quote.ts:31 | est. 240 ms per 3-item quote, stays under 25/s | S | none |
| 2 | Export loads all of `orders` into memory | bin/export.ts:12 | est. 3 GB less peak memory | M | none |
| 3 | Receipt template read and compiled per job | src/jobs/receipt.ts:20 | est. 4 ms CPU per job | XS | none |
| 4 | Order list sorted in full for the top 10 | src/routes/orders.ts:140 | est. 6 ms per page | S | needs OK (tie order) |

Known: P3 (export transaction). #2 touches bin/export.ts like open PR #140 (another concern).
```

Then ask which findings to turn into PRs, in the report's order: AskUserQuestion with multiSelect in Claude Code, otherwise one message with numbered options. Recommend each fix that is correct and worth its win, whatever its size, with a confidence; list effort beside it, and mark a dependency or output change "needs OK". In an unattended run, don't ask: list the picks under "Needs you" and stop after the report.

## Phase 5: PRs for the picks

1. Rerun `open-prs-touching.mjs` on the pick's files right before you start it.
2. Branch off the default branch, one finding per branch, named the way the project names branches (`fix/<short-desc>` when it doesn't say). Do small picks yourself, one at a time. For many or large picks, use parallel agents in their own worktrees (the Agent tool with worktree isolation in Claude Code, `delegate_task` in T3 Code).
3. Fix the cost at its source. Keep output identical wherever the user didn't approve a change, and check each approved difference. Prove it with the `diff-proof` skill if it's installed (identical output and measured before/after numbers); otherwise compare outputs with a script outside the repo. Follow the project's test rules.
4. Run the project's checks: the verify or test command from its `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` or package scripts, and the `self-review` skill if it's installed.
5. Have a fresh reviewer that didn't write the change read the branch diff (the `maintainer-bar` or `second-opinion` skill if installed). Fix structure and appearance yourself; report everything else.
6. Show the user, per pick: the diff size, the win, the review result, and a PR description draft (the `pr-describe` skill if installed, else the project's PR template). A perf number goes in the description only when it was measured, with the machine it ran on. Otherwise leave it out or measure it first. Wait for sign-off.
7. After sign-off, rerun the duplicate check, push the branch (`git push -u origin <branch>`, never a force push), and open the PR with `gh pr create`. Title it the way the project titles commits (`perf(pricing): quote cart items concurrently` for Conventional Commits).

## Rules

- Keep the run lean: one pass per area, no repeated full reruns.
- Keep production details (hostnames, addresses, paths on servers) out of commits and PRs.
- End with the report path, each pick's branch or PR, "Decided for you" for anything you chose, and "Needs you" for picks waiting on sign-off, each with your recommendation.
