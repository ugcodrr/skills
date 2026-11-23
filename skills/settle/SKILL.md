---
name: settle
description: Say what's left before the current thread can be closed, split into what the user has to decide, review or do, what the agent can finish itself, and what's waiting on someone else. Read-only. Use it for /settle, "what's left", "can I close this", "what do you need from me", "are we done", "loose ends", "wrap up", or when coming back to a thread cold. Not for every thread at once (use inbox) or a note that lets someone else continue the work (use handoff).
---

# Settle

Answer one question: what stands between this thread and closing it? Look, don't fix: change nothing until the user says go. The user should be able to read the answer cold, in under a minute.

## 1. Gather

Check only what this thread touched. Skip a source that doesn't apply, and don't mention that you skipped it. Run nothing slow: no tests, builds or full scans. If knowing would need one, the item is "unverified" and goes under Me.

1. **The conversation**, start to end:
   - questions the user asked that never got a full answer
   - questions you asked that the user never answered
   - things you said you'd do, or next steps you listed, that didn't happen
   - choices you made for the user that they haven't seen ("Decided for you")
   - "done", "fixed" or "passing" claims with no check after the last change
   - drafts the user has to send or paste themselves (replies, PR bodies, messages)
2. **Each repo or worktree touched.** From it, run the script with every branch the thread committed to or pushed. It always adds the current branch or detached HEAD. It only reads, and doesn't fetch.

   ```
   node <this skill's folder>/scripts/settle-facts.mjs <branch>... [--remote <name>] [--no-gh]
   ```

   - An `UNKNOWN` line or exit code 2 means a fact couldn't be read. That's unchecked, not clean, so it goes under Me as unverified. Outside GitHub, pass `--no-gh`.
   - The stash list is shared by every worktree, so only stashes this thread made count.
   - "Commits on no live branch" is unpushed work, unless the branch's PR line says `merged` with `head same as local`. That's a squash merge, and the work is in.
3. **PRs the thread opened or pushed** (T3: `list_thread_pull_requests`, else the script's PR lines). `gh` matches PRs by branch name, so a PR is the thread's only if its head is the thread's commit (`head same as local`), not a fork's branch of the same name (`from <owner>`). Look for drafts, failing or pending checks, requested changes, conflicts, unresolved threads, and anything not merged.
4. **Background work** the thread started: shell tasks, monitors, subagents or delegates, scheduled tasks, PR watches. Read each status once and don't poll.
5. **Leftovers**: worktrees and branches for merged work, temp files, dev servers still running.

## 2. Sort

Each item goes in exactly one bucket:

- **You**: only the user can do it. Start with the verb: **Decide** (it changes what ships, publishes something, deletes their work, or is a trade-off they'd care about), **Review** (read a diff, look at a render, try it on a device), or **Do** (send a draft, merge, log in, pay, anything outside your reach).
- **Me**: you can finish it without them, like committing, rerunning a check, cleaning up a worktree, answering a leftover question or verifying a claim.
- **Waiting**: on CI, a reviewer, another thread or a scheduled run. Say who or what, and how the user will hear when it's done.

Each item is one line that names the exact thing (`file:line`, PR number and title, branch, thread link) and gives its evidence in a few words. No evidence means no item. Ideas, nice-to-haves and follow-up work nobody asked for don't block settling, so leave them out. Don't reopen decisions the thread already made.

## 3. Report

The first line is the verdict:

- `Settled.` plus one line on where the work lives (PR link, commit, file). Stop there.
- `Not settled: 2 for you, 3 for me, 1 waiting.`

Then the buckets in order (You, Me, Waiting), skipping empty ones. Keep it under 15 lines.

```
Not settled: 2 for you, 2 for me, 1 waiting.

You
- Decide: keep the old /v1 export route, or drop it in this PR? (src/routes/export.ts:12)
- Do: paste the PR body above into #12 "feat(settle): add skill"

Me
- Commit README.md and docs/STYLE.md (uncommitted)
- Remove worktree ../acme-web-fix-links (branch merged in #9)

Waiting
- CI on #12, 2 of 5 checks still running. The PR page shows when they finish.
```

After the report:

- If You has decisions and the user is around, ask them all in one batch, up to 4, recommendation first (AskUserQuestion in Claude Code, otherwise one message with numbered options). Review and Do items stay in the list. In an unattended run, don't ask. Decisions stay under You.
- If Me isn't empty, end with "Say go and I'll do the Me list." Don't start on it unasked.
- When the user says go (or invoked `/settle go`), do the Me items, then settle once more and report the new verdict. Commits, pushes and posts still follow the user's usual rules for permission.
