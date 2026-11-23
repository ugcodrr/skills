---
name: focus-session
description: Walk the user through a set of PRs or a local stack and get a decision on each. Every PR gets a cleanup review and a separate read-only correctness review, run in parallel in worktrees, then a short walkthrough and one question with your recommendation first. Uses the maintainer-bar skill's bar and reviewer prompt when installed, otherwise the project's own rules. Works on open PRs and on local unpushed stacks, folding approved fixes into the commits they fix. Use it for "focus session", "walk me through these PRs", "go through the stack with me", "review this stack with me", "decide on each PR with me", or a batch of PRs that each need the user's call. Not for an unattended cleanup sweep (maintainer-bar), answering review comments (review-replies), or checking your own branch before hand-back (self-review).
---

# Focus session

The user leaves with a decision on every PR in the set, each backed by a cleanup review and a correctness review they didn't have to read in full. You run the reviewers, check their work, explain each PR in a few lines, and ask.

## Start

- **Rules.** This skill needs the user there; in an unattended run, do the reviews and leave the questions for their return. The project's instructions and the user's own rules govern questions, commits, long jobs and verification. Pushes and description edits need the user's OK. Don't watch checks or draft review replies unless asked. Never comment on, close, merge or mark ready a PR.
- **The set.** Use the PRs, branches or stack the user names. Otherwise build it from `gh pr list --author @me --state open --json number,title,baseRefName,headRefName,isDraft,additions,deletions`: standalone PRs (based on the default branch) and stacks (chains of `baseRefName`). Offer a few groups of up to about 20 PRs in one question.
- **Scope.** With the `maintainer-bar` skill installed (usually next to this folder, at `../maintainer-bar/`), run `../maintainer-bar/scripts/triage.mjs` on the set and follow its scope column. Put the scopes in the group question so the user sees what each PR will get. A `skip` PR gets a fresh pass only when the user asks: then both reviewers take the whole PR, and the correctness reviewer doesn't see earlier findings. Without maintainer-bar, review whole PRs.
- **Owner decisions** override the bar: ledger notes, the project's decision records, and what the user said in this thread. Pass them to both reviewers.
- **Record.** Keep `.agents/focus-session/<date>-<name>/progress.md` in the main checkout: each PR's parent and head SHAs and whether it's pushed, each reviewer's model and effort, each decision, and the reason behind any you reverse. Save each filled brief there too, as `<k>-<branch>.<role>.brief.md`. Keep `.agents/focus-session/` out of git (`.git/info/exclude`); it's how you resume after the context fills up.
- **Order.** Up to 4 independent PRs at a time. A local stack goes one PR at a time, base up, folding approved fixes in before the child's review (`references/local-stack.md`). For a pushed stack, run every PR's reviews first, then apply the approved fixes base up and merge up once.

## Per PR

1. **Two reviewers, in parallel,** each fresh, in its own worktree, pinned to the same parent and head SHAs: T3 Code's `delegate_task` with isolation "worktree" (follow each call's `next`), or Claude Code's Agent tool with `isolation: "worktree"`. With neither, do the cleanup review yourself first, then the correctness review as a separate read.
   - **Cleanup** commits structure and appearance fixes only and never pushes. For an open PR, fill `../maintainer-bar/references/reviewer-prompt.md` and point it at the project's `.agents/maintainer-bar.md`; without maintainer-bar, use the project's rules as the bar. For a local branch, use the prompt in `references/local-stack.md`.
   - **Correctness** is read-only: fill `references/correctness-prompt.md`. Under about 30 changed lines, fold it into the cleanup brief as that file says.
2. **Check their work.** Read every cleanup commit and merge duplicate findings. Settle disagreements between the reviewers against the code, and recheck findings on the final candidate, including bugs the cleanup introduced. Recommend holding a PR with an unresolved correctness concern. A commit that oversteps gets a fresh round from the original head. A fix that belongs to another PR goes to that PR's review; don't apply it here.
3. **Walk the user through it** in at most about 8 lines: what the PR fixes or adds for users, a few quoted diff lines, the cleanup, confirmed bugs, and review feedback that still applies. Say which findings were already on the base.
4. **Ask.** One question per PR, up to 4 independent PRs per call (AskUserQuestion in Claude Code; otherwise one message with numbered options per PR). Each question names the PR (number and title, or branch and stack position) and its findings, then 2 to 4 concrete options:
   - First, your recommendation, marked "(Recommended)", with a one-line reason and a confidence: the most correct fix, naming the PR that owns it and any OK it needs, even when it's the bigger change.
   - Then the others: keep as is, push or fold named fixes, a specific change, or "you close it".
   - Last, "Hold" (skip it for now), saying what stays pending.
   - Name every push target and description change you're asking approval for. Mention drafts that look ready, for the user to mark ready.
   - When a choice changes what users see, show the before and after first (the `pr-visuals` skill if it's installed).

## Spending usage well

Cut repeated reading, not review depth:

- **One reviewer per stack, per role.** A cleanup reviewer can take a pushed stack's PRs base up in one worktree, reading the shared code once. It switches to each PR's head in turn, commits that PR's fixes on that head, and writes that PR's own draft and report. Keep a chain to about 1,500 hand-written changed lines per reviewer. A bigger PR gets its own reviewer, and one over about 3,000 lines gets one per area, each told which folders are theirs.
- **Tiny PRs together.** Standalone PRs under about 30 lines go to one reviewer that does both roles for all of them.
- **Skim generated files.** Reviewers check that lockfile and generated hunks match what the PR's sources explain, without reading them line by line: `git diff --stat` first, then `git diff <range> -- . ':!<lockfile>' ':!<generated folder>'`.
- **Effort.** High by default. The highest for API, storage, concurrency or data-mapping PRs and for any reviewer covering a chain.
- **Give proof already on record.** Hand the correctness reviewer the test run, output comparison or render the ledger or a report already has, so it spends its time on what that proof doesn't cover.
- **Run in parallel.** Independent PRs and chains at once, up to 4, and up to 4 PRs per question.

## Acting on the answers

- **Open PRs.** After approval and a passing verify, use `../maintainer-bar/scripts/pr-apply.mjs`: a dry run first, then `--apply`. `--sha` pushes, `--draft` replaces the description, `--verdict` and `--note` record the decision; a keep or a hold gets its ledger row the same way, with only those two. Leave out what wasn't approved. Without maintainer-bar: `git push <remote> <sha>:refs/heads/<branch>` (never forced, so git refuses anything but a fast-forward), and save the old description to the record before `gh pr edit <n> --body-file <draft>`.
- **Pushed stacks.** Merge up only, never rebase or force-push: the `merge-train` skill if it's installed, otherwise merge each lower branch into the one above. Merging up pushes descendants too, so get approval for every target. Stop and report a conflict in a child.
- **Local stacks.** Fold approved fixes with `references/local-stack.md`: backup refs first, then a rebase with explicit `fixup` and `update-ref` entries, run without an editor. Approval to fold never authorizes a push.
- **After any restack,** run the `self-review` skill at every affected tip against its new parent (`../self-review/scripts/check-diff.mjs --base <parent> --head <branch>` for the committed diff). For a structure-only change to visible output, compare old and new output on the same inputs (the `diff-proof` skill if it's installed); look at intended changes yourself.

## End

Report one line per PR with its decision, then where the decisions are recorded:

```
Focus session: 5 PRs, 5 decided.

- #412 fix(auth): refresh tokens before expiry. Pushed 2 cleanup commits (9c1d2e3f), description rewritten.
- #415 feat(search): cursor pagination. Kept as is; you'll mark it ready.
- #418 refactor(db): move pool setup into the client. Held: pool.end() never runs on SIGTERM (src/db.ts:88), already on the base; fixing it in #421.
- feat/billing (1/2) add the invoice model. Folded 1 fixup and restacked feat/billing-ui on it. Not pushed.
- feat/billing-ui (2/2) add the invoice page. Folded 2 fixups. Not pushed.

Recorded in .agents/maintainer-bar/ledger.md and .agents/focus-session/2026-11-22-billing/progress.md.
Backup refs: refs/backup/20261122T1405/*. Reviewer worktrees are listed in progress.md.
```

Check that every decision, holds included, is in the ledger or progress file. Before you name another thread's branch as needing work, run `git cherry <PR head> <branch>` to see whether it already has the fix, and read that thread's progress notes.
