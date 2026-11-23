# Local stacks

A local stack is a chain of unpushed branches, each cut from the one below. Review it base up, one PR at a time, and fold each approved fix into the commit it fixes before the next PR's review starts, so the child is reviewed against its real parent.

## Reviewer prompt for a local branch

Fill every placeholder, including absolute paths for the bar, the draft and the report:

```
Review local branch <branch>, PR <k> of <n> in <stack>: <title>. Parent <parent SHA>, head <head SHA>. In your worktree, run git switch --detach <head SHA>, and review only <parent SHA>..<head SHA>.
Hold it to <the bar at <absolute path to .agents/maintainer-bar.md> | the project's rules in AGENTS.md, CONTRIBUTING.md and CLAUDE.md>. <If maintainer-bar is installed: follow the cleanup limits, verification and reporting in <absolute path to maintainer-bar's references/reviewer-prompt.md>, and skip its GitHub steps.> Owner decisions override the bar: <decisions, or "none">.
Commit only structure and appearance fixes, each as `fixup! <subject of the commit in this range that introduced the code>`. Report fixes that belong to another PR in the stack instead of making them. Don't amend, rebase, move branch refs or push.
Run the self-review skill against <parent SHA> if it's installed, including your cleanup commits; otherwise the project's verify command.
Write the description to <absolute draft path> and the details to <absolute report path>.
Return: the outcome; full SHAs of your HEAD and each fixup with the commit it targets; your worktree path; findings with file:line and a recommendation; each check's result; verification gaps; any command a hook or permission blocked.
```

## Folding approved fixes

The reviewer's `fixup!` commits sit on a detached HEAD in its worktree; worktrees share objects, so your checkout can use those SHAs directly. Fold only the ones the user approved.

1. **Back up first.** Save every branch tip to `<record>/tips-before-<timestamp>.txt` with `git for-each-ref --format='%(refname) %(objectname)' refs/heads/<branch>...`, and make a backup ref for each: `git update-ref refs/backup/<timestamp>/<branch> <branch>`. Backup refs stay out of `git branch` and nothing prunes them.
2. **Check other worktrees.** `git worktree list` shows any stack branch checked out somewhere else. An `update-ref` line moves such a branch anyway and leaves that worktree's files stale, so for those branches use a temporary ref instead (step 3).
3. **Write the rebase todo yourself.** List every commit from the stack base up with `git log --reverse --format='pick %H %s' <base>..<top>`, then:
   - put `fixup <fixup SHA>` right after the commit each approved fixup names (the SHA can come from the reviewer's worktree; it doesn't have to be in the range);
   - after each lower branch's last commit, add `update-ref refs/heads/<branch>`, or `update-ref refs/fold/<branch>` for a branch checked out in another worktree. The top branch is the one you rebase, so it needs no line.
4. **Run it without an editor.** From the top branch: `GIT_SEQUENCE_EDITOR="cp <todo file>" git rebase -i <base>`. Git hands the editor the todo's path, so `cp` replaces git's todo with yours.
5. **On a conflict, stop.** `git rebase --abort` puts everything back. Report the conflict; don't resolve it by guessing.
6. **Check the result.** For each branch, `git diff refs/backup/<timestamp>/<branch> <branch>` shows only the folded fixes for that branch and the ones below it, and `git range-diff <base>..refs/backup/<timestamp>/<top> <base>..<top>` shows which commits changed. For a branch you tracked with `refs/fold/<branch>`, run `git -C <its worktree> reset --keep refs/fold/<branch>` when that worktree is clean and no session is using it (otherwise ask the user), then `git update-ref -d refs/fold/<branch>`.
7. **Undo, if the user wants the old stack back:** `git update-ref refs/heads/<branch> refs/backup/<timestamp>/<branch>` for each branch.

Stacks joined by merges (each branch merged the one below instead of being rebased onto it) don't fold this way. Use the `merge-train` skill if it's installed; otherwise commit each fix on its own branch and merge it up.

## Gotchas

- A fix low in the stack can break an upper branch (an import, a renamed function). Verify every affected tip, not just the top.
- Approval to fold is approval to rewrite local branches only. Pushing needs its own OK.
- Leave the backup refs and reviewer worktrees for the user to remove, and list them in the report.
