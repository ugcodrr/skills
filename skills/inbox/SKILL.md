---
name: inbox
description: Say what's waiting on the user across every open thread, PR and repo, ranked so what blocks other people comes first, for the morning or after time away. Read-only. Use it for /inbox, "what needs me", "morning check", "catch me up", "what did I miss", "I'm back, where is everything", "what's waiting on me", "which PRs need me". Not for one thread (use settle) or picking one piece of work back up (use handoff).
---

# Inbox

Answer one question: across everything, what is waiting on the user, and in what order should they do it? The user should be able to act from the first line without opening anything else.

Read-only. Don't fetch, push, settle, snooze, comment, rerun CI or mark anything read.

## 1. Gather the GitHub and git facts

From anywhere:

```sh
node <this skill's folder>/scripts/inbox-facts.mjs [repo paths…] [--no-gh]
```

It covers the user's open PRs, the open PRs that request their review, and each repo's worktrees, branches and stashes. It never fetches.

- Repos come from the arguments, then `repos` in `~/.agents/inbox.json` (see `references/inbox.example.json`), then the current repo. `--no-gh` skips GitHub.
- Exit 1 means something needs the user. It isn't an error. `UNKNOWN` lines and exit 2 mean a fact couldn't be read: say so, don't call it clean.
- **needs you** is already ranked (review, reply, fix, merge), oldest first.
- A **waiting** line that says `no review required` has nothing on GitHub blocking it. If the user merges their own PRs, list it as ready to land.
- A branch with "commits on no live remote branch" is work only on this disk. A branch at the head of a merged PR is counted on the repo's last line instead, and it's Quiet.
- When a check always fails for reasons outside the PR (a preview deploy with its own quota, a coverage bot), every PR looks red and the real failures drown. Tell the user to list it in that file's `ignoreChecks`. The project's own instructions may already name a check to ignore.

## 2. Read the threads (T3 Code)

Skip this step when the host has no thread tools. The worktrees then stand in for threads.

1. `t3_thread_list` with `allProjects: true`, `settled: false` and `includeSubagents: false`, paging with `cursor`. Leave out snoozed threads and the thread you're running in (`currentThreadId`).
2. Threads that are `running`, `queued` or `starting`, have pending background tasks, or are `blockedOnThreadWait` go under **Waiting** without a read.
3. For each other thread, `t3_thread_read` with `limit: 2` and `maxCharsPerItem: 3000`. If there are more than about 30, read the ones updated since the user left (what they said, else the last 24 hours) and report the rest as one "not read" line, not as Quiet. Read the last reply only:
   - it asks the user something, or lists Needs you or "for you" items: **Needs you**, with the question
   - it says the work is done and safe to settle, and its PRs are merged: **Quiet**
   - it failed or was interrupted mid-task: **Needs you** ("Do: restart or settle")
4. Match each thread's `pullRequests` to the script's PR lines, so a PR shows once, under its thread.

Use the `settle` skill on one thread only when the user asks to go deeper. It's too slow for every thread.

## 3. Rank

Needs you, in this order. Within a rank, oldest first.

1. **Someone else waits on you**: review requests, a reviewer's unanswered comment, changes requested.
2. **A thread or run idle on your answer.**
3. **Your work can't land**: red checks, conflicts.
4. **Ready to land**: approved and green, so merge it if you merge your own.
5. **Work only on this disk**: uncommitted files, commits no remote has, stashes.
6. **Drafts to look at**: one line per repo with the search link.

Each line starts with Decide, Review or Do, names the exact thing (PR number and title, thread title, absolute path), and links it: the PR URL, or the thread's `link` as the thread list returns it. No evidence, no line. Don't reopen decisions a thread already made.

Waiting: CI running, review required with green checks (name the reviewer when known), running threads, scheduled runs. Quiet: threads safe to settle and clean, fully pushed worktrees. Collapse anything over five lines in a bucket into a count with a link.

## 4. Report

The first line counts each bucket. Keep the whole thing to one screen, about 30 lines.

```
Inbox: 5 need you, 3 waiting, 14 quiet.

Needs you
1. Review: acme/web#88 "feat: dark mode" by bob, requested 2d ago. https://github.com/acme/web/pull/88
2. Do: reply to 2 threads from carol on acme/api#131 "fix(webhooks): retry failed deliveries". https://github.com/acme/api/pull/131
3. Decide: thread "Billing export" asks CSV or Parquet; it recommends CSV.
4. Do: fix `test (node 22)` failing on acme/api#127 "refactor(db): pool config". https://github.com/acme/api/pull/127
5. Do: ~/src/acme-api/.worktrees/spike-cache has 4 uncommitted files and 3 commits no remote has.

Waiting
- acme/api#129, #130: review required, checks green. https://github.com/acme/api/pulls?q=is%3Apr+is%3Aopen+author%3A%40me
- Thread "Nightly deps bump": running.

Quiet
- 14 threads with nothing open (PRs merged, worktrees clean). Settle them from the thread list.
```

Stop after the report. If the user wants to answer the Decide items now, ask them all in one batched question (the `ask` skill, if installed).
