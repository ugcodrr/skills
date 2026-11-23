---
name: handoff
description: Write a cold-start note for the current thread so another agent, or the user next week, can continue it without reading the conversation. Use it for /handoff, "write a handoff", "hand this off", "I'll pick this up later", "pass this to another agent", "write it up so a fresh thread can continue", "context is getting long", or before a thread is compacted or paused with work left. Not for "can I close this" (use settle) or checking whether claims hold (use receipts).
---

# Handoff

Produce a note that lets someone with no access to this conversation continue the work within five minutes. Writing the note is the only change you make: don't fetch, push, commit or stop anything.

## 1. Pull it out of the conversation

Read the thread start to end, including any brief or prompt file the first message named.

- **The goal**, as the user would say it, plus any later change to it.
- **Decisions**, each with its reason in one clause and who made it (the user, or you on their behalf).
- **Ruled out**: what was tried or considered and dropped, with the evidence that dropped it.
- **Open questions**: asked and unanswered, or never asked but needed.
- **The next step**: the one action you'd take now if you kept going.

## 2. Check the live state

Earlier messages go stale, so read the state now. For each repo or worktree the thread touched:

- `git rev-parse --show-toplevel`, `git branch --show-current` and `git rev-parse HEAD` (full SHA).
- `git status --short` and `git stash list`.
- `git log --oneline <default branch>..HEAD` for this branch's commits.
- `git ls-remote --heads <remote> <branch>` to see whether the remote has HEAD, rather than trusting tracking refs.
- `gh pr list --head <branch> --state all --json number,title,url,state,isDraft,reviewDecision,headRefOid`, and confirm the PR's head is your commit, not a same-named fork branch.
- **What passes**: only checks that ran after the last change. If one is cheap (one test file, a typecheck), rerun it. Otherwise write "last passed at `<sha>`" or "not run". Use the `receipts` skill if it's installed.
- **Background work** still running: what it is and where its output lands. Leave it running.

A fact you couldn't read is written as unknown, not left out.

## 3. Write the note

Use the sections in the example, in that order, and leave out an empty one.

- Every state line carries its evidence: a SHA, or a command and its result. Give HEAD's full SHA once, and short SHAs after that.
- Use absolute paths and full links. Never "the file we discussed" or "as above".
- The next step is one concrete action with its file or command, never "continue the work".
- Leave out the story of how you got here. Link long material instead of pasting it.
- No secrets, tokens or private config values.
- Aim for under 40 lines.

Then read it once as a stranger. Rewrite any line that only makes sense if you were there.

## 4. Put it where it survives

1. Where the user said.
2. Otherwise `.agents/handoff/<YYYY-MM-DD>-<slug>.md` in the main checkout (the first path `git worktree list` prints), not in a worktree that might be removed. The folder is working state: keep it out of git (a `.gitignore` of `*` inside it) unless the project tracks it.
3. In chat when the user asked for that, or there's no repo.

If work is uncommitted or unpushed, the note's State says so first, names the worktree, and says it must not be removed. Don't commit or push to make the note tidier. That's the user's call.

Reply with the note's path (or the note itself, for chat) and one line on the next step.

## Example

```markdown
# Handoff: retry failed webhook deliveries

**Goal:** failed webhook deliveries retry with backoff instead of being dropped (acme/api#123).

**State** (checked live)
- Uncommitted: src/webhooks/queue.ts, backoff cap half done. Keep the worktree.
- Branch `fix/webhook-retry` in ~/src/acme-api/.worktrees/webhook-retry, HEAD 3f9c2e1a7b04d5c6e8f9a0b1c2d3e4f5a6b7c8d9, 2 commits ahead of main, and origin has the same SHA.
- PR #131 "fix(webhooks): retry failed deliveries": draft, head 3f9c2e1, CI green.
- `npx vitest run src/webhooks`: 12 passed at 3f9c2e1. Typecheck not run since then.

**Decisions**
- Backoff lives in the queue, not the HTTP client: the client is shared with sync calls that must not wait (user's call).
- At most 5 attempts, per the vendor's retry docs (link below).

**Ruled out**
- The job library's built-in retry: it retries the whole batch, so one dead endpoint delays every delivery. Tried in 8d1e0f2, reverted in 3f9c2e1.

**Next step**
Finish `maxDelayMs` in src/webhooks/queue.ts:42, then run `npx vitest run src/webhooks` and `npm run typecheck`.

**Open questions**
- Should a delivery that runs out of retries alert someone? Asked, not answered. Recommended: log only for now.

**Where things live**
- Worktree: ~/src/acme-api/.worktrees/webhook-retry
- PR: https://github.com/acme/api/pull/131
- Vendor retry docs: https://docs.example.com/webhooks#retries
```
