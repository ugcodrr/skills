---
name: merge-train
description: Plan and carry out merging a GitHub repo's open PRs. A script test-merges every PR against its base and every pair that shares a file (git merge-tree, no branches written), finds stacks, failing checks and drafts, and writes a merge plan. Others carry a fix up a stack with merge commits, verified before a fast-forward push, print the exact restack after a parent squash-merges, and fold fixup! commits into a local stack joined by merges. Use it for "what can merge", "merge order", "which PRs conflict", "plan the merge train", "is the plan still current", "carry this fix up the stack", "update the PRs above this one", "restack after the parent merged", "fold these fixups into the stack", "link the stack", or before merging a PR that shares files with others. Not for reviewing what a PR changes (self-review, maintainer-bar) or for deleting worktrees and branches after merges (worktree-sweep).
---

# Merge train

Answer what can merge now, in what order, and what has to change first. Then do the git work that order needs, without rewriting a pushed branch unless the user said yes to that one push.

Four scripts, run from the root of any checkout of the repo as `node <this skill's folder>/scripts/<name>.mjs`. They need `gh` logged in and git 2.38 or newer.

- `merge-train.mjs` reads only. It fetches each open PR's head into `refs/pr/<n>` in this clone, which is fine: they're local refs GitHub can always give back, and worktree-sweep lists them for deletion.
- `restack.mjs` prints commands and runs none of them.
- `stack-up.mjs` prints a plan. With `--push` it pushes merge commits, fast-forward only.
- `fold-stack.mjs` rewrites local branches only with `--apply`, backs each one up first, and never pushes.

## Settings and state

`.agents/merge-train.json` in the project, every key optional (example in `references/merge-train.json`):

- `verify`: the command that proves a tree is good. It runs in a fresh worktree, so it installs dependencies itself (`npm ci && npm test`). Without it, read the verify command from the project's AGENTS.md, CLAUDE.md, CONTRIBUTING.md or package.json scripts and pass `--verify`.
- `author`: whose PRs to plan, a login, `@me` (the default) or `any`.
- `botAuthors`: logins to leave out, on top of the ones gh marks as bots.
- `lockfiles`: file names whose conflicts are only counted. It replaces the built-in list of common lockfiles.

State lives in `.agents/merge-train/` in the main checkout: `plan.md`, `state.json`, `cache.json`, and `notes.md`, which you write by hand for conflicts git can't see (two PRs that merge cleanly but break together). The script puts a `.gitignore` of `*` in that folder, so it stays out of git. Don't commit it.

## 1. Plan

```sh
node <this skill's folder>/scripts/merge-train.mjs [--author <login>|any] [--bots]
```

It prints each section's count and writes `plan.md`. Read only the sections you need. The first run on a busy repo can take a minute; a rerun tests only what moved.

1. It fetches every open PR's head, forks too, into `refs/pr/<n>`.
2. It test-merges each PR with its base branch (for a stacked PR, the branch the bottom of its stack merges into).
3. It test-merges every pair of PRs that share a file and merge into the same branch. A file that already conflicts with the base is that PR's own rebase problem, not the pair's. Pairs that conflict only in lockfiles are counted, not listed: whichever merges second regenerates its lockfile.
4. It reads stacks from base branches: a PR whose base is another open PR's branch.

`plan.md` lists: ready with no conflicts; ready but conflicting with another open PR (whichever merges second needs the fix); stacks with each parent's tip; conflicts with the base and how far behind; PR heads behind their branch; failing checks (each check's latest run, so a superseded canceled run doesn't count); drafts; the conflicting pairs and their files; then `notes.md`.

A PR head behind its branch means GitHub stopped updating the PR after a push, so reviewers and CI see an old diff. With the user's OK, push an empty commit to that branch so GitHub catches up, then run stack-up for the PR.

For a few PRs, `--only 12 15` prints two lines per PR (its state against its base, then the open PRs it conflicts with, grouped by file) and writes no plan.

Before trusting an existing `plan.md`, run `--check` (a few seconds, writes nothing). It compares `state.json` with the live PRs and base branches and prints moved heads, retargeted bases, new and closed PRs, and how many conflicting pairs they touch. Exit 1 means stale, so rerun the plan. Run the plan while a parent is still open, too: `state.json` is what remembers each child's parent for a restack.

## 2. Carry a fix up a stack

```sh
node <this skill's folder>/scripts/stack-up.mjs <pr> [--push] [--verify '<command>' | --no-verify] [--link]
```

Run it after pushing a change to a PR that has PRs stacked on it. It merges that PR's branch into each PR above it, one level at a time, with `git merge-tree`, so no worktree and no local branch moves. Carry fixes up with merge commits, never by rebasing a pushed stack: a merge adds to what reviewers saw, a rebase rewrites it and needs a force-push.

- Without `--push` it's a dry run. Show it to the user and get their OK for the push.
- `--push` runs the verify command on every merged tip in one temporary worktree, since each PR will merge on its own. Only if every run passes does it push all the merge commits, in one atomic push that the remote refuses unless it's a fast-forward. On a failure nothing is pushed and the worktree stays for a look; remove it before rerunning.
- It pushes only to the user's own PRs. A PR above that isn't theirs stops it before it merges anything. Report that PR instead.
- On a conflict it stops at that level. With `--push` it still verifies and pushes the clean levels below, then prints the hand merge: in a checkout of the child, merge the pushed parent, resolve, and commit with `git commit --no-edit --cleanup=strip` (plain `--no-edit` keeps git's `# Conflicts:` lines in the message). Verify, push with the same OK, then run stack-up for the child to carry it higher.
- `--no-verify` only when the verify just passed on these same merged trees.
- In T3 Code, link each PR you pushed to the thread with `link_pull_request`.

## 3. Link the stack

If the PRs form a GitHub stack (made with the `gh stack` extension, github/gh-stack), pass `--link` or run `gh stack link <bottom pr> ... <top pr>`. Pass PR numbers: given branch names, it pushes them and opens PRs for any without one. Never pass `--open`, which marks every PR ready for review, drafts too. Don't use `gh stack submit` (pushes every branch and opens PRs) or `gh stack rebase` (rewrites the stack, which then needs a force-push). Without `gh stack`, a stack is just PRs based on each other's branches: suggest a line for each description ("Stacked on #12, merge that first") and add it only with the user's OK.

## 4. After a parent squash-merges

```sh
node <this skill's folder>/scripts/restack.mjs <child pr>
```

It checks that the parent merged, lists the commits the child keeps, and prints the restack: a temporary worktree, `rebase --onto <default branch> <old parent tip>`, a log check, the verify, a `push --force-with-lease` pinned to the child's current head, a retarget if GitHub didn't do it, and the worktree removal. If the parent merged with a merge commit, it says no rebase is needed.

- Ask before running the push. It rewrites a pushed branch, and an OK for one PR isn't an OK for the next.
- PRs stacked on the child need the same move after it, each with its own OK. The script prints their rebase lines.
- If the rebase conflicts, resolve each file in the editor rather than taking one side of everything. When one side of a file has to stay whole (the other side moved that code elsewhere), use `git checkout --ours -- <path>` or `--theirs`. In a rebase, "ours" is the branch you're rebasing onto.

## 5. Fold fixups into a local stack

```sh
node <this skill's folder>/scripts/fold-stack.mjs --base <ref> <top branch> [--apply]
```

For an unpushed stack whose branches are joined by merges (each child `git merge`s its parent), which `git rebase --autosquash` can't fold. Each `fixup! <subject>` folds into the one commit in `<base>..` with that subject. The dry run writes the new commits and prints a table per branch with a tree check. `--apply` backs up each branch under `refs/fold-backup/<stamp>/` and moves them all in one transaction. A linear stack can use `git rebase -i --autosquash --update-refs` instead. Read `references/fold-stack.md` before the first use: rewording, maps, drops, and what each stop means.

## After merges

Use the worktree-sweep skill if it's installed, to list the worktrees, branches and `refs/pr/*` refs that can go. Otherwise, for each merged PR, remove its worktree and local branch only when the worktree is clean and the PR's final head contains the branch's tip, and only after the user says yes.

## Rules

- Never push to someone else's PR. Never merge, comment on, review, close or retarget a PR without the user's OK.
- The only forced push is a restack's `--force-with-lease`, approved for that PR.
- Ask for the pushes and the order in one batch at a natural stop (AskUserQuestion in Claude Code, otherwise one message with numbered options), recommendation first. In an unattended run, push nothing and list each push under "Needs you".

## Report

Lead with what can merge right now, then the stacks in order, then what needs a fix and from whom. Quote the conflicting files, not just PR numbers.

```
Ready now, any order: #12 docs: fix typos, #15 test: cover ranges
Ready, in this order:
- #18 then #21: both edit src/router.ts, so #21 needs a fix once #18 merges
- stack #30 -> #31 -> #32: #30 is ready; restack #31 once it merges
Needs a fix:
- #25 conflicts with main in src/app.ts (14 commits behind): its author merges main in
- #27 fails lint
Drafts: #33. Plan checked fresh at 14:02 UTC.
```

When the user wants a list to send a maintainer, use the format in `references/maintainer-list.md`.
