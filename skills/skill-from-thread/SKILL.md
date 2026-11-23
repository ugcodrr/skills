---
name: skill-from-thread
description: Turn a thread where something finally worked into a draft skill. It pulls out the procedure, the user's corrections and the checks that mattered, writes the SKILL.md, strips private names, and shows the draft before it's listed anywhere. Use it for "make this a skill", "turn this thread into a skill", "save how we did this", "so we never have to figure this out again", "write a skill from thread <id>". Not for checking an existing skill (skill-lint) or logging what slowed a thread (hiccups).
---

# Skill from thread

Produce one thing: a draft skill that lets the next agent do what this thread worked out, without the detours. Draft it, show it, and add it to a README, a marketplace or a commit only when the user says so.

## 1. Get the thread

- **The current conversation:** reread it from the first message, including the parts before any compaction summary you can still see.
- **Another thread by id:** in T3 Code, `t3_thread_read` with `view: "activity"` and `afterPosition: -1`, paging forward. Otherwise run:

  ```sh
  node <this skill's folder>/scripts/thread-digest.mjs <session id, its first 8+ characters, or a .jsonl path>
  ```

  It prints a timeline of one Claude Code or Codex session. Tool output is left out, secrets are masked, and long messages are cut (user text at 2,000 characters, agent text at 600), so read the log itself when a correction ends in "…". Claude Code session ids are the file names in `~/.claude/projects/<project folder>/` (`ls -t` puts the newest first). Codex ids end the `rollout-*.jsonl` names under `~/.codex/sessions/`. It exits 2 when no single log matches.

## 2. Find what worked

Write these down before drafting anything:

- **Goal:** the question the thread answered or the thing it produced, in one sentence.
- **Procedure:** the steps of the run that succeeded, in order. Not the first attempt.
- **Corrections:** every "no", "use X instead", "don't", and every interrupt from the user. Each one becomes a rule, with its reason.
- **Commands and checks:** the exact commands that produced the result, and the check that proved it (a test, a diff, a render, a count).
- **Tried and dropped:** what failed and why. Keep the ones a future run would be tempted to retry, as a one-line "don't, because" rule.
- **Project-only details:** names, paths, ids, accounts, dates and values that only meant something in this thread.

If the thread never reached a working result, stop and say so: a skill drafted from it teaches the failure.

## 3. Decide what the skill is

- **Name:** kebab-case, short, easy to say as a command (`release-notes`, not `release-notes-generator-workflow`).
- **Neighbors:** look through `skills/`, or wherever the repo keeps them. If an existing skill covers most of it, propose an edit to that skill instead of a new one. With no skills folder, write to `skills/<name>/` at the repo root and say so.
- **Triggers:** the phrases the user actually typed in the thread, plus the indirect ones ("can I ship this").
- **Script or judgment:** anything the thread did the same way each time (collecting data, comparing outputs, finding a key) goes in `scripts/<name>.mjs` or the repo's script convention: read-only by default, a header comment with usage, exit 0 when clean, 1 on findings, 2 when it couldn't check. Choices that depend on the case stay in the SKILL.md.
- **Settings:** a value someone has to fill in (a verify command, a login, a folder) is read from the project's own instructions or from `.agents/<name>.json|md`, with an example in `references/`. Don't hardcode the thread's value.

## 4. Write the draft

Follow the repo's style guide when it has one (`docs/STYLE.md`, `CONTRIBUTING.md`). Otherwise use the open format ([agentskills.io](https://agentskills.io)):

- frontmatter with `name` (same as the folder) and `description`, in about 500 characters: what it does in the first sentence, then "Use it for" and the quoted trigger phrases, then when not to use it;
- the goal in one or two sentences;
- numbered steps, each naming its command, file or tool;
- short rules that say why;
- one example of the output, in a code block.

Keep the body under about 150 lines and move long checklists and templates to `references/`. Write for an agent in a stranger's repo: name the action first and a host's tool second, with a fallback ("ask the user, with AskUserQuestion in Claude Code, otherwise one message with numbered options"). Gate anything that pushes, posts, deletes or sends behind the user's OK.

## 5. Strip, lint and test

1. Replace every name, path, email, account, repo name and date from the thread with a neutral placeholder (`<repo>`, `acme/api`, `alice`, `#123`). Then grep the draft for the user's name, their home path and the project's name.
2. Use the `skill-lint` skill if it's installed (`node <its folder>/scripts/skill-lint.mjs skills/<name>`), fix every error, and justify each warning you keep. Otherwise check the frontmatter, a description under 1,024 characters, and the links yourself.
3. Run any script you wrote at least twice: once on the thread's own case and once on a messy one (missing input, a dirty tree, no matches). Check the exit code.

## 6. Show the draft

Show the user the whole SKILL.md (in T3 Code, `send_to_user`; otherwise in your reply), then this summary. Don't add it to a README, a plugin or marketplace list, or a commit until they say so.

```
Draft: skills/release-notes/SKILL.md (84 lines) and scripts/collect-prs.mjs

From the thread
- Procedure: steps 1-4 follow the second attempt (merged PRs by milestone), not the first (parsing git log, dropped because it missed squash merges).
- Your corrections, now rules: "group by label, not by author" (step 3); "leave out dependency bumps" (rule 2).
- Script: collect-prs.mjs prints merged PRs for a milestone as JSON. Tested on #123 and on an empty milestone (exit 1).

Stripped: the repo name, two logins, a release date, home paths.
skill-lint: 0 errors, 2 warnings (no README row, in no plugin; both wait on your OK).

Add it to the README and a plugin?
```
