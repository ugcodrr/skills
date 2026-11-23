# fold-stack in detail

```sh
node <this skill's folder>/scripts/fold-stack.mjs --base <ref> <top branch> [--apply]
node <this skill's folder>/scripts/fold-stack.mjs --base <ref> <branch>... [--explicit] [--map <file>] [--apply]
```

Use it for an unpushed stack whose branches are joined by merges (each child `git merge`s its parent). A pushed branch is never folded: that's a rewrite, and the stack-up route (a new commit, merged up) is the one for pushed work.

## What moves

- Given one branch, it moves every local branch whose tip is inside `<base>..<top>`, side branches merged into the stack included. Lower stack branches come in as a merge's second parent, so they aren't on the top's first-parent line.
- If two branches share a tip (a backup branch, say), it stops. Name the branches to move yourself.
- `--explicit` moves exactly the branches named, even one.

## Fixups, rewording and maps

- Each `fixup! <subject>` folds into the one commit in the range with that subject. A missing or repeated subject stops it.
- To reword a commit, make an `amend! <subject>` commit: `git commit --allow-empty -F <file>`, where the file is that subject line, a blank line, then the new full message. It folds the same way and replaces the target's message.
- `--map <file>` takes lines of:
  - `<sha> <target sha>`: fold any commit like a fixup. A map line wins over its subject.
  - `<sha> drop`: for a revert and the commit it reverts. Map both, or it stops.
  - `<sha> keep`: keep a `fixup!` or `amend!` commit as its own commit. It then needs an `amend!` mapped onto it to get a real message.
- A target can't itself fold, and can't be a merge.

## How it rewrites

- It rewrites with `git merge-tree` and `git commit-tree`, not in a worktree. Each commit keeps its old tree plus the fixups, so every merge keeps its old conflict resolution, and rerere isn't involved.
- If a fixup touches lines a later commit changes, it stops and names the files. Make it a fixup of that later commit, or keep it as its own commit on its branch: the stop message prints the `keep` and `amend!` map lines to use.
- It prints each fixup's target and a table per branch: old and new tip, first-parent and merge counts, and a tree check. Each new tree must be the old one plus exactly the fixups that now land in it, so the top's tree is usually unchanged. A mismatch stops it.
- The dry run already writes the new commits, and `--apply` moves the branches to those same SHAs (it keeps each commit's dates). Check out or verify a new tip before applying.

## Applying and undoing

- `--apply` backs up each moved branch as `refs/fold-backup/<stamp>/<branch>` and moves the branches in one `update-ref` transaction.
- Where a worktree has the branch checked out, it uses `git reset --keep` there, and refuses if that worktree has uncommitted changes.
- It prints the undo command for each branch and the `update-ref -d` lines that drop the backups. Dropping them is the user's call; the worktree-sweep skill lists them too.
- When you merge a branch up by hand before or after a fold and resolve a conflict, commit with `git commit --no-edit --cleanup=strip`, so the `# Conflicts:` lines stay out of the message.
- To move a branch to a known tip by hand: on a checked-out branch, `git switch <branch>` then `git merge --ff-only <sha>`. Otherwise `git update-ref refs/heads/<branch> <new> <old>`, which refuses if the branch moved. Don't use `update-ref` on a branch a worktree has checked out: that checkout keeps the old files.
