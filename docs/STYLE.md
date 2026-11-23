# How skills here are written

This is what the skill repos people actually use have in common ([anthropics/skills](https://github.com/anthropics/skills), [mattpocock/skills](https://github.com/mattpocock/skills), [obra/superpowers](https://github.com/obra/superpowers), [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)), plus the rules I already hold my own skills to.

## What the good repos do

- **Installing takes one command.** The README opens with it, for each agent. Nobody reads a setup guide before they've tried a skill.
- **There's one table of skills** with a one-line "use it when" for each, so people can find one in seconds.
- **Every skill stands alone.** A folder holds `SKILL.md` and any `scripts/`, `references/` or `assets/` it needs. You can copy just that folder and it works.
- **Skills are small and composable.** Matt Pocock's are short enough to fork, and superpowers chains narrow skills into one workflow. Neither ships one giant prompt.
- **Each skill has opinions.** It takes a position (`grill-me` won't stop asking questions, `thermo-nuclear` won't go easy on you). A vague "helpful assistant" skill gets ignored.
- **The skills get tested.** superpowers runs its skills against subagents under pressure to see whether they hold up. At the least, try every trigger phrase and read the output cold.
- **They follow the open format** ([agentskills.io](https://agentskills.io)): `name` and `description` frontmatter and plain markdown, so the same folder works in Claude Code, Codex, Cursor and the rest.

## Frontmatter

- `name`: kebab-case and the same as the folder. Short and easy to say as a command (`settle`, not `thread-completion-checker`).
- `description`: the only part an agent reads before it decides to load the skill. Say what it does in the first sentence. Then add "Use it for" and the phrases people actually type, including indirect ones ("can I close this"). Say when *not* to use it if there's a neighbor it could be confused with. Keep it under about 1,000 characters.

## Body

- **Open with the goal in one or two sentences.** What question does this answer, or what does it produce?
- **Steps are numbered and checkable.** Each step names its commands, files or tools.
- **Give one example of the output.** The example does more for the format than any rule.
- **Rules are short and say why** when the reason isn't obvious. "Read-only until the user says go" beats a paragraph about caution.
- **Keep it under about 150 lines.** Move long checklists, rubrics and templates into `references/` and say when to read them.
- **Scripts handle anything deterministic** (collecting PR threads, diffing outputs, finding keys). The model's judgment goes where it's needed.
- **Defaults beat questions.** A skill asks the user only for decisions that are theirs, in one batch. In an unattended run it asks nothing and reports "Decided for you" and "Needs you" at the end.
- **Anything outward-facing is gated.** Pushing, posting, deleting and sending need an explicit OK unless the skill exists to do exactly that. Use a hook to block what must never happen.

## Writing

- Plain words, short sentences, no em dashes, no filler ("I hope this helps", "robust", "seamless").
- Second person to the agent ("Check only what this thread touched"), not "The assistant should...".
- American English (`color`, `behavior`, `canceled`).
- No `TODO`s, and no private names, paths or data. Use a `<placeholder>` where someone has to fill in their own.

## Portability

- **Any agent, any repo.** A skill works in plain Claude Code or Codex. When a host has a better tool (T3 Code's `delegate_task`, Claude Code's AskUserQuestion), name the action first and the tool second, and give the fallback: "ask the user (AskUserQuestion in Claude Code, otherwise one message with numbered options)".
- **The project's rules come from the project.** Read its `AGENTS.md`, `CLAUDE.md` or `CONTRIBUTING.md` for the verify command, the commit style and what's off limits. Don't restate them in the skill.
- **Settings someone fills in live outside the skill folder**, since a plugin update overwrites the folder: `.agents/<skill>.md` (or `.json` for a script) in the project, or `~/.agents/<skill>.md` for the user. Ship a filled-in example in `references/`, and work from sensible defaults when the file doesn't exist. State a skill keeps between runs (a ledger, a log, a cache) goes in `.agents/<skill>/` in the main checkout, so every worktree shares it and it outlives them. The skill says whether that folder belongs in git; when it doesn't, the folder holds a `.gitignore` of `*` (or the path goes in `.git/info/exclude`), so the project's own `.gitignore` stays untouched. Extra checkouts a script builds (a base and a head side by side) go under `~/.cache/<skill>/`, outside the repo, where the project's test runner and module lookup can't find them.
- **Scripts are Node 20+ `.mjs` with no dependencies**, run as `node <this skill's folder>/scripts/<name>.mjs` from the repo root. The header comment gives the usage. They're read-only unless a flag like `--apply` or `--push` says otherwise, and exit 0 when clean, 1 on findings, 2 when they couldn't check. The one exception is a browser driver: load Playwright from `$PW_DIR` or a scratch folder, and never install it into the project.
- **Another skill is optional.** "Use the `settle` skill if it's installed; otherwise check X and Y yourself."
- **Hooks go in the skill's frontmatter** (`hooks:`, Claude Code only), so they load only once someone uses the skill. The rule in the body has to hold without the hook.

## Before adding a skill

1. Run it on a real task in at least two situations, one easy and one messy.
2. Read the output as someone seeing it cold. Cut anything they'd skip.
3. Check the description triggers on the phrases you listed and not on its neighbors.
4. Run the `skill-lint` skill on it and fix every error.
5. Add a row to the README table and list it in a plugin in `.claude-plugin/marketplace.json`.
