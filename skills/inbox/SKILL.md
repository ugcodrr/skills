---
name: inbox
description: Settle across every open thread and project at once, ranked by what's blocking on the user, for the morning or after time away. Reads open threads (in T3 Code), the user's open GitHub PRs, review requests and failing checks, and local worktrees and branches with uncommitted or unpushed work in the repos the user names. A bundled script gathers the GitHub and git facts in a few calls. Read-only. Output is Needs you (decide, review, do) ranked first, then Waiting, then Quiet (safe to settle), one line each with a link. Use it for /inbox, "what needs me", "morning check", "catch me up", "what did I miss", "I'm back, where is everything", "what's waiting on me", "which PRs need me". Not for one thread (use settle) or for picking one piece of work back up (use handoff).
---

# Inbox

Answer one question: across everything, what is waiting on the user, and in what order should they do it? Look, don't touch. The user should be able to act from the first line without opening anything else.

## 1. Gather the GitHub and git facts

From anywhere:

```sh
node <this skill's folder>/scripts/inbox-facts.mjs [repo paths…]
```

It runs two paged GitHub searches (your open PRs, and open PRs requesting your review) and one `git ls-remote` per remote. It never fetches. It prints:

- **needs you**: review requests; your PRs with changes requested or review threads where the reviewer spoke last; failing checks; conflicts; approved and green PRs to merge. Already ranked, oldest first.
- **waiting** and **drafts**: one line per PR, or one line per repo with a search link when there are more than 10.
- **each repo**: worktrees with uncommitted files, branches and detached HEADs with commits no live remote branch has, worktrees missing on disk, and stashes.

Repos come from the arguments, then `repos` in `~/.agents/inbox.json` (see `references/inbox.example.json`), then the current repo. When a check always fails for reasons outside the PR (a preview deploy with its own quota, a coverage bot), list it in that file's `ignoreChecks`, or every PR looks red and the real failures drown. The project's own instructions may already name a check to ignore. `--no-gh` skips GitHub. `UNKNOWN` lines and exit 2 mean a fact couldn't be read: say so, don't call it clean.

## 2. Read the threads (T3 Code)

Skip this step when the host has no thread tools; the worktrees then stand in for threads.

1. `t3_thread_list` with `allProjects: true`, `settled: false` and `includeSubagents: false`, paging with `cursor`. Subagent threads report to their parent and can outnumber real threads many times over. Leave out snoozed threads and the thread you're running in (`currentThreadId`).
2. Threads that are `running`, `queued` or `starting`, have pending background tasks, or are `blockedOnThreadWait` go under **Waiting** without a read.
3. For each other thread, `t3_thread_read` with `limit: 2` and `maxCharsPerItem: 3000`. If there are more than about 30, read the ones updated since the user left (what they said, else the last 24 hours) and report the rest as one "not read" line, not as Quiet. Read the last reply only:
   - it asks the user something, or lists Needs you or "for you" items: **Needs you**, with the question;
   - it says the work is done and safe to settle, and its PRs are merged: **Quiet**;
   - it failed or was interrupted mid-task: **Needs you** ("Do: restart or settle").
4. Match each thread's `pullRequests` to the script's PR lines, so a PR shows once, under its thread.

Use the `settle` skill on one thread only when the user asks to go deeper. It's too slow for every thread.

## 3. Rank

Needs you, in this order. Within a rank, oldest first.

1. **Someone else waits on you**: review requests, a reviewer's unanswered comment, changes requested.
2. **A thread or run idle on your answer.**
3. **Your work can't land**: red checks, conflicts.
4. **Ready to land**: approved and green, so merge it if you merge your own.
5. **Work only on this disk**: uncommitted files, commits no remote has, stashes. Nobody else can see them and a lost disk loses them.
6. **Drafts to look at**: one line per repo with the search link.

Each line starts with Decide, Review or Do, names the exact thing (PR number and title, thread title, absolute path), and links it: the PR URL, or the thread's `link` as the thread list returns it. No evidence, no line.

Waiting: CI running, review required with green checks (name the reviewer when known), running threads, scheduled runs. Quiet: threads safe to settle and clean, fully pushed worktrees. Collapse anything over five lines in a bucket into a count with a link.

## Report

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

## Rules

- Read-only. Don't fetch, push, settle, snooze, comment, rerun CI or mark anything read.
- Don't reopen decisions a thread already made. Only list what's still open.
- If the user wants to answer the Decide items now, ask them all in one batched question (the `ask` skill, if installed). Otherwise stop after the report.
