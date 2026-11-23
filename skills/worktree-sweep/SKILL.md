---
name: worktree-sweep
description: List the git worktrees, local branches and temporary refs whose work is done or safe to drop, in groups with one delete command each, and delete nothing until the user says yes to a group. A script checks each one for a merge (PR merged per gh, every patch upstream per git cherry, or merging it would change nothing), commits no remote has, uncommitted or ignored files, where it's checked out, and whether it's locked or was touched recently. Use it for "clean up worktrees", "which branches can I delete", "prune merged branches", "sweep the repo", "tidy up after the merges", "remove old worktrees", "what's safe to delete", or after a merge train. Not for whether one thread can close (settle) or for planning merges (merge-train).
---

# Worktree sweep

Answer which worktrees, branches and leftover refs can go, with one command per group. Look first. Delete only the groups the user says yes to.

## 1. Run the script

```sh
node <this skill's folder>/scripts/sweep.mjs [--all] [--list <group>]
```

Run it from any checkout of the repo. It's read-only. By default it prints one line per group with its command; `--all` adds a row per item with the reason; `--list <group>` prints the names that group's command takes, which is what the commands pipe. It exits 1 when something can go, 0 when nothing can, 2 when it couldn't check. It takes about a second on a small repo; `git status` in each worktree is most of it.

If the header says the default branch is behind its remote, run `git fetch --all` and rerun, or recent merges won't show.

Settings, all optional, in `.agents/worktree-sweep.json` (in this checkout, else the main one; example in `references/worktree-sweep.json`):

- `recentDays`: a worktree whose index changed within this many days is held back (default 3).
- `keep`: regexes on worktree paths or branch names that the commands never take, like a long-lived docs checkout.
- `buildOutput`: regexes for ignored paths that don't count as work, on top of the built-in dependency and build folders (`node_modules`, `dist`, `target`, `.venv` and the like).
- `tempRefs`: more ref prefixes that only hold leftovers, like `refs/review/`, so they get a delete command.

The skill keeps no state between runs.

## 2. Read the groups

Worktrees, never the main checkout or the one you're in:

- `worktrees/merged`: clean, and its work is in the default branch.
- `worktrees/unmerged`: clean and not merged, but its branch or a remote keeps every commit, so removing the checkout loses nothing. The work may still be in progress.
- `worktrees/detached`: clean, but its detached HEAD holds commits nothing else has. No command: it needs a branch first.
- `worktrees/dirty`: uncommitted or untracked files, ignored files beyond build output (a `.env`, notes), or unreadable. No command.
- `worktrees/missing`: its folder is gone. `git worktree prune` clears the record.

Branches, never the default branch:

- `branches/merged`: the reason says how: no commits beyond the default branch, every patch upstream (rebased or cherry-picked), merging it would change nothing (squash-merged), or its PR merged and the PR's final head contains the branch's tip (from one listing of the repo's 1,000 newest PRs). Squash and rebase merges leave the branch unmerged in git's eyes, which is why the command uses `branch -D`.
- `branches/pushed`: not merged, but a live remote branch has every commit, so only the local name goes. The reason shows an open PR if it has one.
- `branches/unpushed`: commits that are neither merged nor on any remote. Never a command.

Temporary refs: `refs/pr`, `refs/backup`, `refs/fold-backup/<stamp>`, `refs/original` (left by history rewrites) and any prefix in `tempRefs`, grouped by prefix. Other refs outside heads, remotes, tags, notes and the stash show under Other refs with no command, since a tool may keep live state there (T3 Code's `refs/t3`, Gerrit's `refs/changes`). "Only copy" means no branch, tag or remote-tracking ref has that commit, so it's gone for good at the next garbage collection. `refs/pr/<n>` refs are PR heads fetched by the merge-train skill; GitHub still has those.

"On a remote" is checked against each remote's live branches (`git ls-remote`), not the remote-tracking refs, so a branch deleted on GitHub after its merge no longer counts as pushed.

A group's command never takes a locked, kept or recently touched worktree, or a branch that's checked out somewhere. Once its worktree goes, the branch shows up in its group, since each command reads `--list` when it runs.

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

Ask which groups to delete in one question (AskUserQuestion with multiSelect in Claude Code, otherwise one message with numbered options). Recommend the merged groups and `refs/pr`. Offer `worktrees/unmerged` and `branches/pushed` only as "if that work is abandoned". Never offer a group without a command.

## 5. Delete what the user approved

1. Run each approved group's command exactly as printed: worktrees first, then branches, then refs, so freed branches are included.
2. `git worktree remove` refuses a worktree with changes, which is a second guard. It also refuses one with submodules: use `--force` for that worktree only, and only when the sweep just showed it clean.
3. Rerun the sweep and report the new counts.

## Rules

- Never delete anything unasked. A yes to one group isn't a yes to another.
- Never remove a dirty worktree. Never delete a branch whose commits are neither merged nor on a remote.
- In an unattended run, delete nothing. List each group and its command under "Needs you".
- If a local command guard blocks these deletes for agents, give the user the commands to run.
