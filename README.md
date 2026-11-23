# skills

Agent skills I use every day, mostly with Claude Code and Codex in [T3 Code](https://t3.codes). Each one is a folder with a `SKILL.md`, short enough to read in a few minutes and change to fit how you work. None of them need T3 Code. Where a host has a better tool, the skill says so and gives the fallback.

## Install

In Claude Code, add the marketplace, then install the plugins you want:

```text
/plugin marketplace add ugcodrr/skills
/plugin install threads@ugcodrr-skills
/plugin install prs@ugcodrr-skills
/plugin install design@ugcodrr-skills
/plugin install skill-tools@ugcodrr-skills
```

For any other agent, [skills.sh](https://skills.sh) installs all of them or just the ones you pick, in Codex, Cursor, OpenCode and more:

```bash
npx skills add ugcodrr/skills
```

Or copy a folder from `skills/` into `~/.claude/skills/`, or your agent's skills folder, and edit it.

## Skills

### threads

| Skill | Use it when |
| --- | --- |
| [settle](skills/settle/SKILL.md) | You want to know what's left before a thread can close: what you have to decide, review or do, and what the agent can finish on its own. |
| [handoff](skills/handoff/SKILL.md) | Another agent, or you later, needs to pick up a thread without reading the conversation. |
| [receipts](skills/receipts/SKILL.md) | You want proof that the "done", "fixed" and "passing" claims in a thread still hold after the last change. |
| [retro](skills/retro/SKILL.md) | You want a thread's corrections turned into instruction lines, so the same mistakes don't happen again. |
| [unattended](skills/unattended/SKILL.md) | A run will go overnight, on a schedule, in a loop or "until X" with nobody watching. |
| [inbox](skills/inbox/SKILL.md) | You're back after time away and want everything waiting on you across threads, PRs and repos, ranked. |
| [ask](skills/ask/SKILL.md) | The agent is about to ask you something, or should decide it and tell you at the end. |
| [second-opinion](skills/second-opinion/SKILL.md) | You want a plan, diff or finding list checked by a fresh agent or another model that hasn't seen your conclusion. |
| [hiccups](skills/hiccups/SKILL.md) | Agents keep hitting the same blocked command, slow step or workaround, and you want it logged, ranked and fixed. |
| [context-audit](skills/context-audit/SKILL.md) | Sessions fill up fast and you want to know which tools, reads and polling loops fill the context. |
| [split-threads](skills/split-threads/SKILL.md) | A feature is big enough to split across parallel agents, each on its own branch, and land as one verified branch. |
| [worktree-sweep](skills/worktree-sweep/SKILL.md) | You want to clean up worktrees, branches and refs whose work is merged or safe to drop, one group at a time. |

### prs

| Skill | Use it when |
| --- | --- |
| [self-review](skills/self-review/SKILL.md) | You're about to hand back or push a branch and want verify, a diff checker and a read of the diff run until it's clean. |
| [maintainer-bar](skills/maintainer-bar/SKILL.md) | Your open PRs need to meet a named maintainer's bar before they get to them. |
| [review-replies](skills/review-replies/SKILL.md) | Reviewers commented on your PRs and you want fixes committed and replies drafted for you to post. It never posts. |
| [focus-session](skills/focus-session/SKILL.md) | A set of PRs or a local stack each need your call, with a cleanup and a correctness review behind every question. |
| [merge-train](skills/merge-train/SKILL.md) | You want to know what can merge and in what order, which PRs conflict, or to carry a fix up a stack and restack after a merge. |
| [diff-proof](skills/diff-proof/SKILL.md) | A refactor, cleanup or perf change needs proof of what it changes in the output, with numbers a PR can quote. |
| [perf-review](skills/perf-review/SKILL.md) | You want a performance review ranked by real wins in your production context, with PRs only for what you approve. |
| [pr-describe](skills/pr-describe/SKILL.md) | You need a PR description written from the diff, ready to paste. |
| [commit-split](skills/commit-split/SKILL.md) | Your working tree mixes unrelated changes and you want one clean commit per change. |
| [explain-diff](skills/explain-diff/SKILL.md) | Someone who doesn't code needs to know what a diff changes and what could go wrong. |

### design

| Skill | Use it when |
| --- | --- |
| [gridlines](skills/gridlines/SKILL.md) | A layout looks off at the edges and you want guide lines drawn, the misses found and the padding fixed. |
| [design-hillclimb](skills/design-hillclimb/SKILL.md) | A screen or rendered image needs a measured design pass: one defect at a time, a blind judge, then keep, A/B or drop. |
| [pr-visuals](skills/pr-visuals/SKILL.md) | A PR changes what users see in a web app and needs framed before/after screenshots. |

### skill-tools

| Skill | Use it when |
| --- | --- |
| [skill-lint](skills/skill-lint/SKILL.md) | You're about to publish or commit a skill and want it checked against the style guide. |
| [skill-from-thread](skills/skill-from-thread/SKILL.md) | A thread finally got something working and you want it saved as a skill. |

## Settings

Skills that need your project's details, like a verify command, a maintainer's bar or the probes to compare, read them from `.agents/<skill>.md` or `.agents/<skill>.json` in the project, or from `~/.agents/` for settings you want everywhere. Most ship an example in their `references/` folder and work without one where they can. Settings live outside the skill folder, so updating a plugin never overwrites them.

## How they're written

Every skill here follows [docs/STYLE.md](docs/STYLE.md). The short version:

- The description says what the skill does and the phrases that should trigger it.
- The body is a procedure, not an essay. Steps, rules and one example of the output.
- Anything deterministic goes in a script: plain Node, no dependencies. Long reference material goes in `references/`.
- Each skill is read-only or asks before it does anything you can't undo.

[docs/ROADMAP.md](docs/ROADMAP.md) lists what's next.

## License

MIT
