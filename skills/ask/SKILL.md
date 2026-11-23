---
name: ask
description: How to ask the user a question that's fast to answer, or decide it yourself when the call isn't theirs. Use it before any AskUserQuestion call or question to the user, when another skill says to ask, and for "ask me first", "check with me before", "stop asking so many questions", "just decide", "batch your questions", or "I can't tell what you're asking". Not for listing what's left in a thread, including "what do you need from me" (use settle).
---

# Ask

A question costs the user a context switch. Ask only for calls that are theirs, ask them all at once, and make each one answerable from the question alone. Most of the time the right move is to decide and say so at the end.

## 1. Decide whether to ask

Ask when:

- a big or open-ended task really forks in scope at the start (ask once, with everything, then work without stopping)
- the call is the user's: it changes what ships, pushes or publishes something, deletes or overwrites their work, or picks between trade-offs they'd care about
- the user asked you to check with them

Decide it yourself, and mention it in the final report, when:

- the code, docs, earlier messages or a sensible default answer it
- you're about 95% sure, and it needs no OK and is easy to undo
- it would only confirm your plan, or ask for permission already given

In an unattended run (overnight, scheduled, a loop, "keep going until X", or the user said they're away), ask nothing. Take the recommended option when it's safe and reversible, skip what isn't, and report both at the end under **Decided for you** and **Needs you**. As a subagent, never ask: put the question in your report for the lead.

## 2. Batch

Hold questions until a natural stopping point and ask them in one call. Don't drip them one at a time. AskUserQuestion takes up to four questions. If you have more, ask the four that block the most and decide the rest.

Without a question tool, send one message with the questions numbered. Under each, list the options lettered, the recommendation first, and ask for replies like "1a, 2c". Then stop and wait.

## 3. Write each question

- **It stands alone.** The user is coming to it cold. Name the exact thing (PR number and title, file, branch, thread) and give a line or two on what you found and why it matters. No "the issue above".
- **The recommendation goes first**, labeled "(Recommended)", with a one-line reason and a confidence ("85%"). When someone else makes the final call (a maintainer, a reviewer), add how likely they are to agree: "85% best, 70% the maintainer agrees".
- **Recommend the most correct fix**, the one that solves the problem where it lives. Effort, diff size, a new dependency or a rewrite are costs. List them beside the option, and don't rank it lower for them. If it needs an OK (a dependency, an output change, a push), it still goes first, marked "needs OK".
- **2 to 4 options, each saying what you'll do**: "Rename the flag and update the 3 callers", not "Option A".
- **Skip goes last** when the call can wait, and says what happens then: "Skip: leave it as is, and the warning stays in CI".
- **multiSelect** when the options aren't exclusive (which of these fixes to build).
- **A short, specific header**: "#123 retries", not "Question".

## 4. Read the answer

Read the choice and any note carefully. A note can change the plan or tell you to stop. Don't re-ask what was answered.

## Example

```
Header: #123 retries
Question: PR #123 "fix(webhooks): retry failed deliveries" retries forever when an endpoint returns 410 Gone, so dead endpoints fill the queue (src/webhooks/queue.ts:42). How should a 410 be handled?
Options:
1. Treat 410 as final and disable the endpoint (Recommended, 85%): it's the vendor's documented meaning; adds a migration for the new `disabled_at` column.
2. Treat 410 as final but keep the endpoint enabled: no migration, but the next event retries it again.
3. Keep retrying with the 5-attempt cap: no change in behavior beyond the cap.
4. Skip: ship #123 as is and open an issue for 410s.
```

The opposite is "What should I do about the error?" with "Option A" and "Option B": the user has to scroll back and investigate before they can answer.
