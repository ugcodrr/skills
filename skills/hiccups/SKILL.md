---
name: hiccups
description: Keep a friction log of what keeps costing agents time or tokens (blocked commands, tool limits, slow steps, stalls, repo gaps, process waste), then fix the worst with the user's OK. Log one whenever something just cost you a retry or a workaround, in a couple of tool calls, then carry on. Use it for /hiccups, a "hiccups review", "what slows the agents down", "what keeps blocking us", "fix the annoyances". Not for measuring what tools put into context (use context-audit).
---

# Hiccups

A hiccup is friction that will happen again: something that made you stop, retry, work around, wait or spend tokens for no gain. Log each one in a couple of tool calls and carry on. Fixes wait for a review, and the user picks which to build.

## Where entries live

One file per entry, so threads logging at the same time never share a file. By default they go in `.agents/hiccups/entries/` in the repo's main checkout, from any worktree. For one log across projects, name a folder in `~/.agents/hiccups.json` (see `references/hiccups.json`).

Whether that folder is in git is the project's call. If the project tracks it, commit an entry by its path alone, following the project's commit rules. Otherwise leave it untracked.

```sh
node <this skill's folder>/scripts/hiccups.mjs list [--all]   # open entries, ranked (--all: every status)
node <this skill's folder>/scripts/hiccups.mjs find <words>   # entries of any status that mention every word
node <this skill's folder>/scripts/hiccups.mjs next-id        # the next free id and the file to write
```

The script only reads. Exit 2 means the settings or an entry couldn't be read.

## Log one

Log it when it happens, or in your final report step. Don't stop your task for it.

It counts when it's one of these:

- a command a permission rule, sandbox or command guard blocked, that you worked around
- a tool or script that failed, hung, or returned wrong or truncated data
- a step much slower than expected
- a workaround you had to work out again
- a thread, subagent or background job that stalled or sat idle
- a review that caught a prompt or plan assuming the wrong code
- a rule that forced a long detour

It doesn't count when it's your own typo, a one-off network blip, or an expected failure that a check exists to catch.

1. Run `hiccups.mjs find <a few words>`. If an entry already covers it, add one sighting line, raise `seen` by 1 and set `last_seen`. If that entry is `fixed`, the fix didn't hold, so set it back to `open`. Then you're done.
2. If it's new, run `hiccups.mjs next-id` and write the file it names (`<id>-<short-slug>.md`) from the template below, as a new file. If that name is taken, run `next-id` again.
3. Commit it only if the project tracks the folder.

Two threads can still pick the same id at once. That makes two files, never a lost one, and `list` prints `duplicate id`. The entry written later (yours, if you just wrote it) takes a fresh `next-id`: rename its file and its `id:`.

```markdown
---
id: H<n>
title: <what goes wrong, in a few words>
status: open
category: <blocked-command | tool-limit | slow-step | stall | repo-gap | process>
seen: 1
last_seen: <YYYY-MM-DD>
cost: <1-5>
fix_size: <XS | S | M | L>
---

**What happens:** <one or two sentences, with the exact command, file:line or message>

**Workaround today:** <what agents do instead, or "none">

**Fix idea:** <the change that would remove it, and where it lands: a script, skill text, the project's agent instructions, a permission rule, a product change>

**Sightings:**
- <YYYY-MM-DD>, <thread title or link>: <one line>
```

- **`cost`:** 1 is seconds, 2 one retry, 3 minutes or a few thousand tokens, 4 a stalled step or a review round, 5 a stopped or failed run.
- **`fix_size`:** XS is a line of docs, S a small script change, M a new script or a skill rework, L a repo or config change that needs other people.
- **`status`:** `open` has no fix yet, and only these are ranked. `mitigated` has a documented workaround that's enough for now. Reopen it if sightings keep coming. `fixed` carries a "**Fixed:**" line naming the commit or PR. `wont-fix` carries the user's reason.

Rules for an entry:

- No secrets, tokens, config file contents or personal data (names, ids, emails). Quote at most a short, non-secret snippet of a command or message.
- Keep to the facts you saw. Mark guesses as guesses.
- While logging, don't change permission or guard settings, the project's agent instructions or another skill. Those are fixes, and fixes wait for the review.

## Review the log (when the user asks)

1. **List.** `hiccups.mjs list` orders the open entries by `seen × cost ÷ fix size`. That order is only where to start. Recommend the fix that addresses the cause, and show its size beside it.
2. **Recheck the top ones.** Make sure each is still real, since a script may have been fixed since. Close any that aren't (`status: fixed`, with what fixed it).
3. **Second opinion,** if the user wants one or the list is long. Use the `second-opinion` skill if it's installed. Otherwise give the open entry files to another model, read-only, for a ranking and a check of each fix. Give it the entries, not your ranking.
4. **Ask the user** in one batch (AskUserQuestion in Claude Code, with up to 4 questions, each multiSelect; otherwise one message with numbered options). Group the questions by where the fixes land: scripts, skill and doc text, agent instructions, tool or permission settings, product code. Put the recommended fixes first. Each option gives the entry id and title, the fix and where it lands, its size, and what it saves, with a confidence when it isn't obvious. In an unattended run, don't ask and build nothing. Report the ranked list under "Needs you".
5. **Build the approved ones**, and nothing else:
   - **Scripts, skills and docs:** follow the project's commit rules. Delete any text a fix makes unnecessary, in the same change.
   - **Agent instructions** (`AGENTS.md`, `CLAUDE.md`): only the approved lines. Every thread reads them.
   - **Product code:** on a branch, and a PR only if the user said so.
   - **Tool, permission or guard settings:** the exact change approved, nothing wider. Prefer a script or a narrow rule to loosening a guard for everything.
   - **Too big for this thread:** write it up where the project keeps tasks (an issue, a prompt file) and say so.
6. **Mark the entries.** `status: fixed` with a "**Fixed:**" line naming the commit or PR, or `status: wont-fix` with the user's reason. Keep the files as the record of what was tried.
7. **Report:**

```
Hiccups review: 3 fixed, 1 won't fix, 4 still open.

Fixed
- H4 gh picks the upstream repo in forks: default repo set in scripts/setup.sh (a1b2c3d)
- H7 the full test suite runs for one-file changes: `npm test -- --changed` in CONTRIBUTING.md (e4f5a6b)
- H9 lint prints 4,000 lines: `--quiet` in the "lint" script (c7d8e9f)

Won't fix
- H2 sandbox blocks network in tests: tests stay offline.

Still open
- H11 preview server hangs on first start (M): not picked this round.
- H12, H14, H15: below the cut; rechecked, still real.
```
