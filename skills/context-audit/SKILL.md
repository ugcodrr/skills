---
name: context-audit
description: Measure what tools put into agent context, from the local Claude Code and Codex session logs, and turn the biggest costs into concrete fixes. A bundled script sizes tool results per session, tool and shell command, and lists the largest results, files read three or more times in a session, and commands repeated in a row (likely polling). It prints only sizes, tool names, paths and two-word command labels, never message text or tool output. Use it for /context-audit, "what's eating my context", "why do my sessions compact so fast", "token audit", "which tools are the noisiest", "are my agents polling", "make my skills cheaper", or before trimming a skill or script for size. Not for logging one slow or blocked step (use hiccups).
---

# Context audit

Answer one question: what fills the agents' context, and which few changes would cut the most of it? The script does the counting. You trace each big number to the script, skill step or habit behind it, and propose a fix. Change nothing until the user picks.

## 1. Run the script

```sh
node <this skill's folder>/scripts/context-audit.mjs --since 7d [--project <path substring>] [--sessions 25]
```

- `--since` takes `24h` (the default), `7d` or a time like `2026-01-31T09:00Z`. Use the window the user named; otherwise 7d.
- `--project` keeps sessions whose working directory contains the substring. Use the repo's folder name when the user asks about "this project".
- It reads `~/.claude/projects/` (with Agent subagents, shown as `<session>/<agent>`) and `~/.codex/sessions/`, read-only, in a second or two. It exits 2 on bad arguments, when neither folder exists, or when no session matched.

Never open the log files yourself, and don't quote anything from them. They hold whole conversations, tool output and sometimes keys. The script prints only what's safe to quote; if a number needs explaining, look at the tool or script that produced it, not the log.

## 2. Read the numbers

Sizes are bytes of tool-result text, about 4 bytes per token. Images count apart, since their cost follows their pixels. Claude Code cuts shell output at about 30 KB, so shell rarely shows in Largest even when it's most of the total: its cost is many medium results, and "Shell commands by total text" is where to look. `unknown` is a result whose call came before `--since`.

| Pattern in the output | Likely cause | Fix to propose |
| --- | --- | --- |
| One command leads the shell totals or Largest (`Bash: npm test`) | a script or tool that prints everything | a quiet flag, a summary line, failures only |
| `cat`, `sed -n`, `git diff` lead the shell totals | whole files and diffs printed to read a part | `grep -n` first, then a line range; `git diff --stat` before the full diff |
| `Read:` of one big file, many times | a skill step that reads a whole file | read a slice (a heading, a line range, `grep -n`), or split the file |
| A file read 3+ times in a session | the step order makes it reread, or it's too long to keep in view | read it once at the right step, or shorten it |
| The same command 5+ times in a row | polling a check, a job or another thread | wait instead: a background job's completion notice, a watch flag (`gh pr checks --watch`), the host's wait tool |
| An MCP tool with big results | verbose JSON for a small question | a narrower query, a field list, a limit |
| Subagent ids near the top | briefs that tell subagents to dump whole files | brief them to return conclusions, not file contents |
| Many images from one tool | full-size screenshots | smaller or fewer screenshots |

## 3. Trace each top item to its source

For the five or so biggest items, find what issued them: grep the repo, its skills and its scripts for the command or path, and check which project the session ran in. A finding names the exact file to change. A number you can't trace to a file is a guess; say so and leave it out of the fixes.

## 4. Propose fixes

One line each: the file, the change, the estimated saving (result size × how often it happens in the window) and the fix size (XS, S, M, L). Order them by saving, and recommend the fix that removes the cause over one that trims the symptom.

Ask the user which to build, in one batch (AskUserQuestion in Claude Code, multiSelect; otherwise one message with numbered options). Don't change anything before they answer. Build the picked ones following the project's own rules for commits and branches. If the `hiccups` skill is installed, log the ones not picked as hiccups so they aren't lost.

The logs only change as new sessions run, so don't rerun the audit to check a fix in the same thread. Say when a rerun would show it (after a few sessions that use the changed step).

## Report

```
Context audit, last 7 days, acme-api: 12 sessions, 18 MB of tool results, 40 images.

1. scripts/test.sh prints every passing test: 31 results of 40-60 KB (Bash: npm test), about 1.4 MB.
   Fix: failures and the summary only (`--reporter dot`). Saves about 1.2 MB a week. S.
2. The release skill reads CHANGELOG.md whole, 3-5 times a session in 9 sessions.
   Fix: step 2 reads the newest section only. About 600 KB. XS.
3. `gh pr checks` 8-14 times in a row in 4 sessions (polling).
   Fix: run `gh pr checks --watch` in the background and act on its exit. XS.

Which should I build?
```

Quote only what the script printed. Paths can carry private names, so trim them to repo-relative before quoting in anything public.
