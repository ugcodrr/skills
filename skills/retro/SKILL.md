---
name: retro
description: Turn what the user had to correct in a thread into proposed instruction lines, so the next agent doesn't need the same correction. It asks once which to keep and writes only the approved lines. Use it for /retro, "what should go in AGENTS.md", "remember this for next time", "don't make me say this again", "learn from this thread", "update your instructions", "what did I have to correct". Not for logging tool friction (use hiccups) or turning a procedure into a skill (use skill-from-thread).
---

# Retro

Produce the few instruction lines that would have made this thread's corrections unnecessary. Propose, ask once, and write only what the user approves. Never commit them.

## 1. Find the corrections

Read the thread start to end. Quote each candidate in a few words:

- The user corrected you: "no", "not that", "I said", "again", "stop", "why did you".
- The user repeated an instruction you'd already been given.
- You assumed something and it turned out wrong: a command, a branch, a path, a convention.
- You made the same mistake twice.
- The user rewrote your output (a commit message, a PR body, a reply). The difference between their version and yours is the rule.
- You asked something the code, docs or instructions could have answered.

## 2. Filter

Drop a candidate when:

- **The instructions already say it.** Read the project's AGENTS.md or CLAUDE.md (and nested ones in folders the thread touched), the user's global instructions (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`), the skill that was running, and the host's memory. Grep for the key words. If the rule is there and you broke it, don't add a second copy. Propose a sharper rewording of that line only if it's ambiguous, and quote it.
- **It's a one-off.** "Use blue here" is about this task. A line earns its place when it happened twice, when the user stated it as standing ("always", "never", "I prefer"), or when the wrong assumption would recur in any thread in this repo.
- **It goes stale fast**: a branch name, a PR number, today's state of a service.
- **A tool should enforce it.** If a lint rule, a hook or a test would catch it every time, propose that instead, and say so.

## 3. Pick the home

The most specific place that's loaded when the rule matters:

- **Project AGENTS.md or CLAUDE.md**: this repo's commands, conventions, paths and limits, and only what the team would accept. Use whichever file the project treats as the main one (a CLAUDE.md that only imports AGENTS.md means AGENTS.md).
- **The user's global instructions**: how this user works everywhere, like asking, commits, tone and PR style.
- **A skill**: a step inside a procedure. Name the skill and the step. If the skill came from a plugin, an update overwrites its folder, so put the line in its settings file (`.agents/<skill>.md`) or suggest it upstream.
- **Memory**: a fact about the user or their setup that isn't a rule ("the test database needs `make db-up` first"). Only if the host has a memory feature.

## 4. Write the proposals

Write each one as the line itself, in the voice and format of the file it goes into, ready to paste. Under it, say why (the quote, and how many times it came up) and where (the file and section). Keep the best seven at most. Use the example's format, with the dropped candidates on one last line. If nothing survives the filter, say "Nothing new: the instructions already cover what came up," and stop.

## 5. Ask once

Ask which to keep in one call: one question per home, multiSelect, with up to four lines each (AskUserQuestion in Claude Code, otherwise one message with numbered proposals and "reply with the numbers to keep"). A home with one proposal gets Keep and Skip as its options. Put the line you'd most recommend first in each question. Use the `ask` skill if it's installed. In an unattended run, don't ask and write nothing. List the proposals under "Needs you".

## 6. Write the approved lines

- Read the target file fresh. Put the line in the section it belongs to, and match the wording around it. Don't reformat anything else.
- If a line replaces an existing one, edit that line rather than adding a near-duplicate.
- Don't commit. Project files show up in the diff for the user to commit. Global instructions and memory aren't in the repo.
- Report each line you wrote with its `file:line`.

## Example

```
Retro: 4 proposals from 7 corrections (2 already in AGENTS.md, 1 one-off).

1. AGENTS.md, "Testing": "Run `pnpm test --filter <package>`, never bare `pnpm test`: the full suite needs a local database."
   Why: corrected twice ("it'll hang, filter it").
2. Global instructions, "Commits": "Never amend a pushed commit. Add a new commit instead."
   Why: "don't amend, I already pulled that", said as a standing rule.
3. Skill `release`, step 3: "Read the version from package.json, not the latest tag. Tags lag on hotfix branches."
   Why: wrong assumption, the release notes had to be redone.
4. Memory: "The test database here needs `make db-up` before `npm test`."
   Why: compose failed twice before the user explained it.

Dropped: "use a bar chart" (one-off); "don't push without asking" (AGENTS.md, "Git" already says it).
```
