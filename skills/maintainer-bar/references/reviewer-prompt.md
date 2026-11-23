# Reviewer prompt

Fill every `<…>` and send it as the reviewer's task, with worktree isolation. Use absolute paths for the bar, the draft and the report, since the reviewer's worktree is somewhere else. In the Return lines, only `<n>` is yours to fill; the reviewer fills the rest.

```
Review and clean up PR #<n> (<title>) in <owner/repo>. Branch <branch>, base <base>, head <head sha>. It's the user's own PR. Hold it to the maintainer bar in <absolute path to .agents/maintainer-bar.md>, and read that first.

The user's notes on this PR, which override the bar: <the ledger note, or "none">.

Scope: <"the whole PR" | "the whole PR, as a fresh polish pass: earlier reviews passed it, so don't read <report path> until you're done, and look harder at every comment, name and structure than a first pass would" | "only <reviewed sha>..<head sha>. The rest passed this review on <date>; its report is <report path>, so read that first and don't reopen what it settled">.

Setup: git fetch <remote> <branch> <base> && git switch --detach <head sha>. Install dependencies only if verify needs them.

How to run things:
- Run verify and any setup in the foreground, with your shell tool's longest timeout. Never end your turn while a command is still running in the background.
- To check conflicts with another PR, fetch its head without naming a ref (git fetch <remote> pull/<m>/head) and test with git merge-tree --write-tree on the SHAs. Don't create refs or branches: the clone is shared.

1. Read the PR: gh pr view <n> --repo <owner/repo> --json title,body,comments,reviews, its inline comments with gh api --paginate repos/<owner/repo>/pulls/<n>/comments, and the diff in scope (git diff <remote>/<base>...HEAD for the whole PR, git diff <reviewed sha> HEAD for a delta). Attribute each request to its author and compare it with the current code: an old changes-requested review or an outdated thread doesn't prove the concern remains. Check that the fix still has a job on the current base.
2. Run the self-review skill with --base <remote>/<base> if it's installed. Otherwise run the project's verify command and read the diff against its rules (AGENTS.md, CONTRIBUTING.md, CLAUDE.md). A warning on a line that was already that way on the base isn't this PR's to fix: mention it once and move on.
3. Fix what the bar asks for when the fix only changes structure or appearance: duplication, the wrong model or layer, extra shapes and casts, needless checks and repeated work, names, comments, tests the change doesn't need, formatting, lockfile drift, and hunks outside the PR's concern. Before removing anything that looks unused, search for its callers and dynamic uses. For comments the PR adds or touches, delete narration and restated code, and improve names or structure before adding prose. Keep the contracts and short notes the bar says the maintainer keeps. Keep what the PR does. Each fix is a new commit on the detached HEAD, in the project's commit style. Don't amend, rebase or push.
4. Don't fix these; list them instead: changes to what the PR does beyond structure and appearance (what a command, endpoint or page returns, stored data, schemas, or any other behavior, however small), adopting a dependency, obsolete behavior that should be deleted or redesigned, a split into more PRs, and a reason the maintainer might not want the PR (only with a concrete reason from the bar). When the right fix needs a wider change, name the layer that owns it and the trade-off; don't add a special case or an explanation instead. For each item, recommend the most correct fix and put its costs beside it (diff size, a new dependency, changed output), marked "needs OK" where it needs one. A cost is never the reason to recommend keeping hand-written code.
5. After your last commit, run the project's verify command. With no commits, skip it and say so; the PR's CI covers its head. If anything users see changed, look at it (a render, a screenshot, the running app) and record what you couldn't check.
6. Draft the description for the diff as it now stands. Follow the project's PR template or guidance; use the pr-describe skill if it's installed. Without either: one or two sentences on what was wrong or missing and what changes for the user, one "Testing:" line, and implementation notes only if they help a reviewer, in a collapsed <details> block. Keep screenshots and stack or merge-order notes. Write the draft, and nothing else, to <absolute draft path>, replacing what's there.
7. Write the details to <absolute report path>, replacing what's there: each item for the user with file:line, why, and the change you'd make; this worktree's path; the diff against the base (+added/-deleted) before and after; the description's length before and after; each check and its result, kept warnings with reasons, and verification gaps.

Return this compact handoff (omit optional lines when empty; keep the verification line even when everything passed):
Outcome: PR #<n> ready as is | cleaned up | needs you: <main change or blocker>
Needs you: <file:line> <action or decision, with your recommendation>, one per item
HEAD: <full sha> in <this worktree's path>
Commits: <hash> <message>, one per line, or none
Verification: verify <passed | failed at <step> | skipped: <why>>; visual check <done | none needed | gap: <why>>
Draft: <draft path>
Report: <report path>
Blocked: each command a hook or permission blocked, with the reason, only when present

Never close, comment on, review or push to the PR.
```
