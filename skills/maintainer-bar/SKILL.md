---
name: maintainer-bar
description: Clean up your own open PRs to the bar a named maintainer reviews at, so they stop reading as sloppy. The bar lives in the project (.agents/maintainer-bar.md, naming who the maintainer is and what they ask for, with PR numbers as evidence), and a script drafts it from what they changed on other people's PRs. One reviewer per PR, each in its own worktree, commits structure and appearance fixes only. You check every commit, push fast-forwards after the user's OK, and rewrite each description to fit its diff. A ledger skips PRs nothing has changed on. It never closes, opens, merges or comments on a PR. Use it for "get my PRs ready for <maintainer>", "clean up my open PRs", "sweep my PRs", "de-sloppify", "maintainer-level review", or to write or recalibrate a maintainer bar. Not for answering review comments (review-replies), a walk through PRs with a decision on each (focus-session), or your own branch before hand-back (self-review).
---

# Maintainer bar

You're the lead. Reviewers take one PR each in their own worktree and commit fixes. You check their commits, push what holds up, rewrite descriptions, and report. The bar is the project's `.agents/maintainer-bar.md`. Don't re-derive it from GitHub during a sweep.

## What it may and may not do

- **May:** commit structure and appearance fixes to the user's own open PR branches (through reviewers), push them as fast-forwards, rewrite those PRs' descriptions, and merge a lower stacked branch into the branch above it.
- **Only after the user's OK:** every push and description edit, unless the user already authorized pushes for this run. One OK can cover a batch when your plan named each target.
- **Never:** close, open, merge, comment on or review a PR, request reviews, amend, rebase, force-push, or touch the default branch or tags. Never push to someone else's PR.
- **Not here:** review comments and requested changes belong to the `review-replies` skill if it's installed. Otherwise list them under Needs you. Don't reply to them.
- **Report instead of doing:** changes to what a PR does beyond structure and appearance, a PR that should be split, and a PR the maintainer might not want. Recommend dropping a PR only with a concrete reason from the bar, never by default. The user closes PRs.

## Setup, once per project

1. **The bar.** If `.agents/maintainer-bar.md` doesn't exist, write it from `references/bar-template.md`, whose "How to calibrate it" starts with `node <this skill's folder>/scripts/maintainer-edits.mjs --maintainer <login> --since <date>`. Show the user the draft before the first sweep.
2. **State.** The ledger, drafts, reports and saved descriptions go in `.agents/maintainer-bar/` in the main checkout, even when you run from a linked worktree; `<state>` below means that folder's absolute path. Keep the bar and the state out of git: add `.agents/maintainer-bar.md` and `.agents/maintainer-bar/` to `.git/info/exclude`. Notes on how one maintainer reviews don't belong in their repo.

## Scope

- **Which PRs:** by default, every open PR of the user's: `gh pr list --author @me --state open --json number,title,headRefName,baseRefName,additions,deletions,isDraft`. The user can name others or a cutoff date.
- **Ledger:** `<state>/ledger.md` holds one row per PR: head reviewed, verdict, date, note. The note is the user's calls on that PR and its open items, at most 250 characters. Read it first and pass it to that PR's reviewer. Details go in `reports/<n>.md`.
- **Triage:** `node <this skill's folder>/scripts/triage.mjs [<n>...]` prints each PR's scope against its row:
  - `full` (no row, or the head was rewritten): the whole review.
  - `delta` (new commits): a reviewer told to review only `<reviewed>..<head>`.
  - `recheck` (same head, but the base touched its files, it conflicts, or someone commented): yours. Read the new comments and base commits, and start a reviewer only if one of them changes what the PR does.
  - `skip`: nothing, unless the user asks for a fresh pass.
- **Order:** batches of up to 4, newest first. A PR whose base is another PR's branch waits for that PR.

## Steps

1. Work from a checkout of the up-to-date default branch: reviewer worktrees start at your commit, so an old branch makes every reviewer install and build twice. Run `node <this skill's folder>/scripts/ledger.mjs archive` (it moves merged and closed PRs out of the ledger), then triage.
2. Show the plan in one message: each PR, its scope, the batches. Ask once, in one batch, for anything that's the user's call, such as whether pushes are pre-authorized. In an unattended run, go ahead and hold every push.
3. Start one reviewer per PR in the batch, with `references/reviewer-prompt.md` filled in (the draft goes to `<state>/drafts/<n>.md`, the report to `<state>/reports/<n>.md`) and worktree isolation: T3 Code's `delegate_task` with isolation "worktree" (follow each call's `next`, don't poll `task_status`), or Claude Code's Agent tool with `isolation: "worktree"`. With neither, review the PRs yourself one at a time in `git worktree add --detach <path> <head sha>`. Where you can set effort: medium under about 50 changed lines (count a delta's lines, not the PR's), high above that, the highest for API, data or stacked PRs.
4. When a reviewer returns, read its commits from your checkout (worktrees share objects): `git log --oneline <remote>/<branch>..<sha>` and `git diff <remote>/<branch> <sha>`. Every commit has to meet the bar and stay inside "May". Check each removal of code that looked unused.
5. If a commit oversteps, don't push it. Start a fresh reviewer from the PR head with the original brief, the reviewer's findings, and your objection.
6. Read the draft against the diff. Then dry-run the apply:
   `node <this skill's folder>/scripts/pr-apply.mjs <n> --sha <sha> --draft <state>/drafts/<n>.md --verdict "<verdict>" --note "<note>"`
   It checks that the PR is the user's and open, and that `<sha>` fast-forwards the branch on whichever remote holds it (a fork included). It prints the commits it would push and the description diff, and warns when the new description drops images. Leave out `--sha` or `--draft` when there's nothing to push or no description change.
7. Once the user has OK'd it (or under pre-authorization), rerun with `--apply`. It pushes only a fast-forward, saves the old description to `<state>/bodies/`, edits the description, updates the ledger row, and prints the checks. Don't poll the checks: in T3 Code, `watch_pull_request`; otherwise look again when the user asks. A check that fails because of the PR gets another round.
8. When another PR is stacked on this one, carry the change up before the upper PR's review: the `merge-train` skill if it's installed. Otherwise merge the lower branch into each branch above it (a merge commit, never a rebase), stop at the first conflict and report it, run verify on the top tip, and push the merges as fast-forwards after the user's OK.

## Rules

- The project's own rules apply, including its verify before every push. The reviewer's verify counts when `<sha>` is the head it verified.
- Use the scripts for descriptions and the ledger. Don't hand-edit the table.
- Leave reviewers' worktrees for the user to remove, and list their paths in the reports. Before you call a worktree or branch safe to delete, check that no other thread or session still uses it.

## Report

After each batch, and once at the end of the sweep without repeating batch details:

```
Maintainer bar: 4 PRs, 2 cleaned up, 1 ready as is, 1 needs you.

- #412 fix(auth): refresh tokens before expiry. Cleaned up: cut 3 narrating comments, renamed check() to isExpired(). Pushed 1a2b3c4d, description rewritten.
- #415 feat(search): cursor pagination. Ready as is.
- #418 refactor(db): move pool setup into the client. Cleaned up: dropped an unrelated formatting hunk. Pushed 5e6f7a8b.
- #420 feat(api): bulk invites. Needs you.

Needs you
- #420 src/invites.ts:40: drops the `inviteCount` field outright, where the bar says breaking changes go behind a deprecation (#377). Recommend keeping the field for one release with a `Deprecation` header (needs OK: changes the response).

Reports: .agents/maintainer-bar/reports/412.md, 418.md, 420.md
```

Ask the Needs you decisions in one batch (AskUserQuestion in Claude Code, up to 4 per call; otherwise one message with numbered options), recommendation first with its reason. In an unattended run, leave them in the report.
