---
name: worktree-sweep
description: List the git worktrees, local branches and leftover refs whose work is merged or safe to drop, in groups with one delete command each. It deletes nothing until the user says yes to a group. Use it for "clean up worktrees", "which branches can I delete", "prune merged branches", "sweep the repo", "tidy up after the merges", "what's safe to delete", or after a merge train. Not for whether one thread can close (use settle) or planning merges (use merge-train).
---

# Worktree sweep

Answer which worktrees, branches and leftover refs can go, with one command per group. Look first. Delete only the groups the user says yes to.

## Rules

- Never delete anything unasked. A yes to one group isn't a yes to another.
- Never remove a dirty worktree. Never delete a branch whose commits are neither merged nor on a remote.
- In an unattended run, delete nothing. List each group and its command under "Needs you".
- If a local command guard blocks these deletes for agents, give the user the commands to run.

## 1. Run the script

```sh
node <this skill's folder>/scripts/sweep.mjs [--all] [--list <group>]
```

Run it from any checkout of the repo. It deletes nothing. By default it prints one line per group with its command. `--all` adds a row per item with the reason. `--list <group>` prints the names that group's command takes. It exits 1 when something can go, 0 when nothing can, 2 when it couldn't check.

Read the notes under the header before the groups. If the default branch is behind its remote, or live remote branches aren't fetched, run `git fetch --all` and rerun, or recent merges won't show. If a remote couldn't be reached or `gh` isn't available, say so in the report.

Settings, all optional, in `.agents/worktree-sweep.json` (in this checkout, else the main one; example in `references/worktree-sweep.json`):

- `recentDays`: a worktree whose index changed within this many days is held back (default 3).
- `keep`: regexes on worktree paths or branch names that the commands never take, like a long-lived docs checkout.
- `buildOutput`: regexes for ignored paths that don't count as work, on top of the built-in dependency and build folders (`node_modules`, `dist`, `target`, `.venv` and the like).
- `tempRefs`: more ref prefixes that only hold leftovers, like `refs/review/`, so they get a delete command.

## 2. Read the groups

Each group's line says what it holds. A group whose command is `none` is never deleted. What the lines don't say:

- The main checkout, the checkout you're in and the default branch are never listed.
- `worktrees/unmerged` loses no commits, since its branch or a remote keeps them, but the work may still be in progress.
- `worktrees/dirty` counts ignored files beyond build output (a `.env`, notes) as work.
- `branches/merged` uses `branch -D` because squash and rebase merges leave the branch unmerged in git's eyes. A "PR merged" reason means the PR's final head contains the branch's tip, checked against the repo's 1,000 newest PRs.
- `branches/pushed` isn't merged. A live remote branch has every commit, so only the local name goes. The reason shows an open PR if it has one.
- "On a remote" is checked against each remote's live branches (`git ls-remote`), not the remote-tracking refs, so a branch deleted on GitHub after its merge no longer counts as pushed.
- A command never takes a locked, kept or recently touched worktree, or a branch that's checked out somewhere. Those are "held back". Once its worktree goes, the branch shows up in its group, since each command reads `--list` when it runs.

Temporary refs get a command, grouped by prefix: `refs/pr`, `refs/backup`, `refs/fold-backup/<stamp>`, `refs/original` (left by history rewrites) and any prefix in `tempRefs`.

- `refs/pr/<n>` refs are PR heads fetched by the merge-train skill. GitHub still has those.
- "Only copy" means no branch, tag or remote-tracking ref has that commit, so deleting the ref would lose it for good at the next garbage collection. The command never takes those refs: they count as held back. If the user still wants one gone, give them `git update-ref -d <ref>` to run themselves.
- Other refs show with no command, since a tool may keep live state there (T3 Code's `refs/t3`, Gerrit's `refs/changes`).

## 3. Check who owns each worktree

The script can't see which agent thread or session is using a worktree. Before offering a worktree group:

- In T3 Code, list the unsettled threads (`t3_thread_list`) and each one's worktrees (`t3_worktree_list` with its `threadId`). Hold back any worktree an open thread still uses, and say which thread.
- Elsewhere, treat worktrees in a host's own folder (for example `.claude/worktrees/` or `~/.codex/worktrees/`) as possibly in use unless they're merged or the user says the session is done.

## 4. Report, then ask once

The first line counts what can go, what's held back and what needs the user. Then one line per group, with a few names and reasons.

```
Sweep of ~/code/api: 9 can go, 3 held back, 2 need you.

- worktrees/merged: 2 (fix-login: PR #41 merged; docs-typo: squash-merged). 1 held back, touched today
- branches/merged: 5, plus 2 more once their worktrees go
- refs/pr: 12 PR heads from merge-train, all still on GitHub
Needs you:
- worktrees/dirty: ../api-spike has 3 changed files
- branches/unpushed: experiment has 4 commits no remote has. Push it or keep it
```

Ask which groups to delete in one question (AskUserQuestion with multiSelect in Claude Code, otherwise one message with numbered options).

- Recommend the merged groups and `refs/pr`.
- Offer `worktrees/unmerged` and `branches/pushed` only as "if that work is abandoned".
- Offer any other ref group with a command, and name its held-back only copies in the report.
- Never offer a group without a command.

## 5. Delete what the user approved

1. Run each approved group's command exactly as printed: worktrees first, then branches, then refs, so freed branches are included.
2. `git worktree remove` refuses a worktree with changes, which is a second guard. Don't force past it. It also refuses one with submodules: use `--force` for that worktree only, and only when the sweep just showed it clean.
3. Rerun the sweep and report the new counts.
