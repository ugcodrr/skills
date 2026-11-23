---
name: skill-lint
description: Check agent skills (folders with a SKILL.md) against a style guide before you publish or commit them. A script flags the mechanical problems, then you read each skill once for what a script can't judge. Use it for "lint my skills", "check this skill", "is this skill ready to publish", "review my SKILL.md", before adding a skill to a repo or marketplace, and after editing one. Not for writing a new skill from scratch (skill-from-thread or your skill-creator).
---

# Skill lint

Answer one question: is this skill ready for someone else to install? The script catches what grep can. You judge the rest.

## 1. Run the script

From the repo root, since it reads the deny list from the current directory:

```sh
node <this skill's folder>/scripts/skill-lint.mjs [skill folders or folders of skills]
```

With no arguments it checks every skill under `./skills`. It's read-only and takes under a second. Each line is `LEVEL  file:line  message`. It exits 1 on any ERROR, and 2 when it found no `SKILL.md` to check.

- **ERROR** breaks the open format or leaks something private. Fix it.
- **WARN** needs judgment. Fix it, or keep it and say why in your report.

Private names come from `.agents/skill-lint.json` (`{ "deny": ["my-name", "my-employer"] }`, regexes, case-insensitive) plus `--deny <regex>`. Home paths (`/Users/<name>`, `/home/<name>`) are always flagged. If the repo has no deny list and the skills came from private work, write one before you trust a clean run. Keep that file out of git: it lists the names you're keeping out.

When the repo has a `README.md` or `.claude-plugin/marketplace.json`, the script also warns about a skill missing from the README's table or from every plugin.

## 2. Read each skill once

The script can't judge these. Check every skill in scope against the repo's style guide (`docs/STYLE.md` or similar), or against this list when there isn't one:

- **Description:** the first sentence says what it does. It lists the phrases people actually type, including indirect ones, and names a neighbor it could be confused with. It loads in every session, so it stays at about 500 characters (the script warns above 500 and errors above 1,024).
- **Goal first:** the body opens with the question it answers or the thing it produces.
- **Steps are checkable:** numbered, and each names its command, file or tool.
- **One example of the output**, in a code block.
- **Deterministic work is in a script**, not described in prose for the model to redo each time.
- **Stands alone:** everything it needs is in its folder. A reference to another skill names it and says what happens when it isn't installed.
- **Gated:** pushing, posting, deleting and sending need the user's OK, unless the skill exists to do exactly that.
- **No leftovers** from the project it came from: a person's name, a repo's paths, a team's tool, a date that only meant something there.

## 3. Report

Fix what you can, then rerun the script so the counts are current. Report one line per skill: ready or not, and the reason.

```
skill-lint: 3 skills, 0 errors, 2 kept warnings

- handoff: ready.
- merge-train: ready. Kept WARN body is 162 lines: the restack steps have to stay together.
- inbox: not ready. The description never says when not to use it (settle covers one thread).
```
