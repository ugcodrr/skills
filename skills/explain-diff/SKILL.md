---
name: explain-diff
description: Explain a diff or PR in plain language for someone who doesn't code. Says what changes for users, then walks each meaningful change with one or two quoted diff lines and what they mean, names the risks in plain words, and says what wasn't touched. Short, no jargon, and any term it can't avoid is defined once. Use it for "explain this PR", "what does this change do", "walk me through the diff in plain English", "explain it like I don't code", "summarize this for my manager", "what's the risk of merging this", or before someone non-technical signs off on a change. Not for a code review (it doesn't hunt for bugs) or for writing the PR description (pr-describe).
---

# Explain diff

Tell someone who doesn't code what a change does for the people who use the product, what could go wrong, and what was left alone, in a minute of reading. Read-only.

## 1. Get the diff

- **A PR:** `gh pr view <n> --json title,body,url,baseRefName,files` and `gh pr diff <n>`.
- **A branch:** `git log <base>..HEAD` and `git diff <base>...HEAD`, where the base is the default branch unless the user names one.
- **A commit or a range:** `git show <sha>`, or `git diff <a>..<b>`.
- **Uncommitted work:** `git diff HEAD`, plus `git status --short` for new files.

Read the PR description and any linked issue for what the change is meant to do. Then describe what the diff actually does. If the two disagree, say so under Risks.

Skip generated files, lockfiles and formatting-only changes. Mention them in one line under Not changed if they're a big part of the diff.

## 2. Write it

Four parts, in this order:

1. **What changes for users.** One to three sentences on what someone using the product will notice. If nothing visible changes, say that and say why the change exists ("Nothing you'd notice. It makes saving faster when the list is long.").
2. **The changes.** One short item per meaningful change, the biggest first, six at most. For each, a plain sentence on what it does, one or two lines quoted from the diff in a `diff` code block, and what those lines mean.
3. **Risks.** What could go wrong, in plain words, and how likely it is. Look for changed behavior that existing users rely on, changes to stored data, anything hard to undo, and changes with no test. "None I could find" is a fine answer when it's true.
4. **Not changed.** The nearby things a reader might worry about that this leaves alone, taken from the list of files the diff touches ("Payments aren't touched.").

Rules:

- No jargon. When a term can't be avoided, define it once, in a few words, the first time it appears: "a migration (a one-time script that reshapes saved data)".
- Quote real lines from the diff and keep their `+` and `-`. Say once that `+` lines were added and `-` lines removed.
- Name things by what they do ("the sign-up form"), not by file or function, unless the reader asked for files.
- Keep it under about 40 lines for a typical PR. A big diff gets the same six items, grouped by purpose.
- Explain; don't review. No style opinions or fix suggestions unless asked. A real risk still goes under Risks.

## Example

````
What changes for users
A canceled upload now stops right away. Before, the app kept retrying in the background, so a file you canceled could still show up minutes later.

The changes
Lines starting with + were added and lines starting with - were removed.

1. The retry loop checks for a cancel before every new try.
   ```diff
   + if (signal.aborted) return;
   ```
   If the user canceled, it stops instead of trying again.

2. The wait between tries can be cut short.
   ```diff
   - await sleep(delay);
   + await sleep(delay, { signal });
   ```
   The app used to wait out the full pause (up to 30 seconds) before noticing a cancel. Now a cancel ends the pause at once.

Risks
Low. Anything else that calls the retry code without a way to cancel works as before. There's no test yet for canceling during the pause, so that path was only checked by hand.

Not changed
How many times it retries, how long it waits, and the upload screen itself.
````
