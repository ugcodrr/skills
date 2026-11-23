---
name: merge-train
description: Plan and carry out merging a GitHub repo's open PRs. It finds which are ready, which conflict and which are stacked, then does the git work that order needs. Use it for "what can merge", "merge order", "which PRs conflict", "is the plan still current", "carry this fix up the stack", "restack after the parent merged", "fold these fixups", "link the stack", or before merging a PR that shares files with others. Not for reviewing a PR (self-review) or cleanup after merges (worktree-sweep).
---

# Merge train

Answer what can merge now, in what order, and what has to change first. Then do the git work that order needs. Run only the sections the request calls for.

The scripts run from the root of any checkout of the repo as `node <this skill's folder>/scripts/<name>.mjs`. They need `gh` logged in and git 2.38 or newer.

## Rules

- Never push to someone else's PR. Never merge, comment on, review, close or retarget a PR without the user's OK.
- Carry fixes up a pushed stack with merge commits, never a rebase. The only forced push is a restack's `--force-with-lease`, approved for that one PR.
- Ask for the pushes and the order in one batch at a natural stop (AskUserQuestion in Claude Code, otherwise one message with numbered options), recommendation first. In an unattended run, push nothing and list each push under "Needs you".

## Settings and state

`.agents/merge-train.json` in the project, every key optional (example in `references/merge-train.json`):

- `verify`: the command that proves a tree is good. It runs in a fresh worktree, so it installs dependencies itself (`npm ci && npm test`). Without it, read the command from the project's AGENTS.md, CLAUDE.md, CONTRIBUTING.md or package.json scripts. Pass it to `stack-up.mjs` as `--verify`, and put it where `restack.mjs` prints `<the project's verify command>`.
- `author`: whose PRs to plan, a login, `@me` (the default) or `any`.
- `botAuthors`: logins to leave out, on top of the ones gh marks as bots.
- `lockfiles`: file names whose conflicts are only counted. It replaces the built-in list.

State lives in `.agents/merge-train/` in the main checkout, which the script keeps out of git: `plan.md`, `state.json`, `cache.json` and `notes.md`. Write `notes.md` by hand for conflicts git can't see (two PRs that merge cleanly but break together). The plan quotes it.

## 1. Plan

```sh
node <this skill's folder>/scripts/merge-train.mjs [--author <login>|any] [--bots]
```

It only reads. The one thing it writes in git is each open PR's head as `refs/pr/<n>`, which worktree-sweep lists for deletion. It prints a count per section and writes `plan.md`. Read only the sections you need. The first run on a busy repo can take a minute. A rerun tests only what moved.

- `--only 12 15` prints two lines per PR (its state against its base, then the open PRs it conflicts with, by file) and writes no plan.
- `--check` says whether an existing `plan.md` is still current. Run it before trusting one. It takes a few seconds and writes nothing. Exit 1 means stale, and exit 2 with no `state.json` means there's no plan yet. Either way, rerun the plan.
- Run the plan while a parent PR is still open, too. `state.json` is what remembers each child's parent for section 4.

How to read `plan.md`:

- **Ready** means not a draft, not stacked, merges cleanly into its base and has no failing check. Checks can still be running (the line says so), and the script doesn't read reviews. When the answer depends on approval, check `gh pr view <n> --json reviewDecision`.
- A check is judged by its latest run, so a superseded canceled run doesn't count as failing.
- Only pairs that share a file and merge into the same branch are tested. A file that already conflicts with the base counts against that PR, not the pair.
- Pairs that conflict only in lockfiles are counted, not listed. Whichever merges second regenerates its lockfile.
- **PR heads behind their branch** means GitHub stopped updating the PR after a push, so reviewers and CI see an old diff. With the user's OK, push an empty commit to that branch, then run section 2 for the PR.

## 2. Carry a fix up a stack

```sh
node <this skill's folder>/scripts/stack-up.mjs <pr> [--push] [--verify '<command>' | --no-verify] [--link]
```

Run it after pushing a change to a PR that has PRs stacked on it (PRs whose base is its branch). It merges that branch into each PR above, one level at a time, without a worktree or moving a local branch.

1. Run it without `--push`. That's a dry run. Show it to the user and get their OK for the push.
2. Run it with `--push`. It runs the verify command on every merged tip in one temporary worktree. Only if every run passes does it push all the merge commits, in one atomic fast-forward push.
3. In T3 Code, link each PR you pushed to the thread with `link_pull_request`.

When it stops (exit 1):

- **Verify failed:** nothing is pushed and the worktree stays for a look. Remove it before rerunning.
- **A PR above isn't the user's and needs the merge:** nothing is merged. Report that PR instead.
- **Conflict:** it stops at that level. With `--push` it still verifies and pushes the clean levels below, then prints the hand merge. Do it in a checkout of the child, and commit with `git commit --no-edit --cleanup=strip` (plain `--no-edit` keeps git's `# Conflicts:` lines). Verify, push with the same OK, then run stack-up for the child to carry it higher.

Pass `--no-verify` only when the verify just passed on these same merged trees.

## 3. Link the stack

If the PRs form a GitHub stack (made with the `gh stack` extension, github/gh-stack), add `--link` to the `--push` run, or run `gh stack link <bottom pr> ... <top pr>`.

- Pass PR numbers. Given branch names, it pushes them and opens PRs for any without one.
- Never pass `--open`, which marks every PR ready for review, drafts too.
- Don't use `gh stack submit` (pushes every branch and opens PRs) or `gh stack rebase` (rewrites the stack, which then needs a force-push).
- Without `gh stack`, a stack is just PRs based on each other's branches. Suggest a line for each description ("Stacked on #12, merge that first") and add it only with the user's OK.

## 4. After a parent squash-merges

```sh
node <this skill's folder>/scripts/restack.mjs <child pr>
```

It runs nothing. It lists the commits the child keeps and prints the restack: a rebase in a temporary worktree, a log check, the verify, and a `push --force-with-lease` pinned to the child's current head. If the parent merged with a merge commit, it says no rebase is needed.

- Ask before running the push. It rewrites a pushed branch, and an OK for one PR isn't an OK for the next.
- Run the printed commands in order. Stop before the push if the log check lists a commit the script didn't, or if the verify fails.
- PRs stacked on the child need the same move after it, each with its own OK. The script prints their rebase lines.
- If the rebase conflicts, resolve each file in the editor rather than taking one side of everything. When one side of a file has to stay whole (the other side moved that code elsewhere), use `git checkout --ours -- <path>` or `--theirs`. In a rebase, "ours" is the branch you're rebasing onto.

## 5. Fold fixups into a local stack

```sh
node <this skill's folder>/scripts/fold-stack.mjs --base <ref> <top branch> [--apply]
```

For an unpushed stack whose branches are joined by merges (each child `git merge`s its parent), which `git rebase --autosquash` can't fold. A linear stack can use `git rebase -i --autosquash --update-refs` instead.

1. Check that no branch in the stack is pushed: `git ls-remote --heads <remote> <branch>...` prints nothing. The script doesn't check. A pushed branch is never folded, so use section 2 for it.
2. Read `references/fold-stack.md` before the first run in a thread, and whenever the script stops. It covers rewording, `--map` lines, drops, and what each stop means.
3. Run it without `--apply`. Each `fixup! <subject>` folds into the one commit in `<base>..` with that subject. Check the table it prints for each branch.
4. Run it with `--apply`. It backs up each branch under `refs/fold-backup/<stamp>/` and moves them all in one transaction. It never pushes.

## 6. After merges

Use the worktree-sweep skill if it's installed, to list the worktrees, branches and `refs/pr/*` refs that can go. Otherwise, for each merged PR, remove its worktree and local branch only when the worktree is clean and the PR's final head contains the branch's tip, and only after the user says yes.

## Report

Lead with what can merge right now, then the stacks in order, then what needs a fix and from whom. Quote the conflicting files, not just PR numbers.

```
Ready now, any order: #12 docs: fix typos, #15 test: cover ranges
Ready, in this order:
- #18 then #21: both edit src/router.ts, so #21 needs a fix once #18 merges
- stack #30 -> #31 -> #32: #30 is ready; restack #31 once it merges
Needs a fix:
- #25 conflicts with main in src/app.ts (14 commits behind): its author merges main in
Drafts: #33. Plan checked fresh at 14:02 UTC.
```

When the user wants a list to send a maintainer, use the format in `references/maintainer-list.md`.
