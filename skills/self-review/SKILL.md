---
name: self-review
description: Review your own branch before you hand it back or push it, and loop until it's clean. It runs the project's verify command and a diff checker, then one judgment pass. Use it before the last commit or hand-back of any task, and for "self-review", "review my diff", "is this ready", "double-check before I push", "check this against the rules", or a cleanup pass, even when no one asked for a review. Not for someone else's PR (a code review skill) or your open PRs (maintainer-bar).
---

# Self-review

Answer one question: is this branch ready to hand back? A script checks what grep can, you judge the rest, and you repeat until a full pass is clean.

## Settings

Optional, in `.agents/self-review.json` in the project, over `~/.agents/self-review.json` for rules you want everywhere (project keys win). `references/self-review.example.json` shows every key:

- `verify`: the command that has to pass.
- `protected`: path globs, gitignore-style, each with an optional `reason`. Touching one is an ERROR.
- `licenseHeader`: a `pattern` (regex) that new files matching `files` (globs) must carry near the top.
- `deny`: regexes that must not appear on added lines, each with an optional `message` that says the fix.
- `americanSpelling`: flag British spellings on added lines and in commit messages.
- `commentBlockLines`: the longest comment block allowed before a WARN (default 2).

Without a file, the `protected`, `licenseHeader`, `deny` and `americanSpelling` checks are off and the rest still runs. Commit the file if the team shares the rules.

## 1. Base

```sh
node <this skill's folder>/scripts/check-diff.mjs [--base <ref>] [--head <ref>]
```

It's read-only and takes about a second. Run it now for its header. The `base:` line names the base it picked and the merge-base: the ref the branch was created from (per `git reflog`), else the branch with the nearest merge-base.

Review against the branch you started from, not the default branch, or a branch cut from another feature branch shows that branch's work as yours. If the pick isn't where you started, pass `--base <ref>` on every run. To read the diff yourself, run `git diff <the merge-base sha>`. It includes uncommitted changes, and `git status --short` lists untracked files.

## 2. Verify

Find the project's verify command, first match wins:

1. `verify` in the settings file.
2. The project's instructions: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, the README's development section. The CI workflow (`.github/workflows/*.yml` or similar) shows what has to pass.
3. Its scripts. The header's `verify:` line lists the `package.json` scripts and Makefile targets it found. Otherwise use the ecosystem's default (`cargo clippy && cargo test`, `go vet ./... && go test ./...`, `pytest`).

Run it. If it takes more than a minute, run it in the background and act on the completion notice instead of polling. Fix every failure before step 3. If the project has no verify command at all, say so in the report.

## 3. Mechanical check

Run `check-diff.mjs` again. Without `--head` it covers committed, uncommitted and untracked files. With `--head` it checks that commit range only. Each line is `LEVEL  file:line  message`, and the message says the fix. It exits 1 on any ERROR and 2 when it couldn't check (not a repo, unreadable settings).

- **ERROR** means a rule is broken. Fix it. If the user explicitly asked for that exact change, keep it and say so in the report.
- **WARN** needs judgment. Fix it, or name it in the report with the reason you kept it.

Three fixes need more than the message says:

- **Protected path:** edit those hunks out. Don't restore the file from the base over uncommitted work you still need.
- **A secret** (a token-shaped string, a private key, or a file like `.env`, `id_rsa` or `credentials.json`): take it out. If a commit on the branch already holds it, tell the user. Rewriting the branch is their call, and a secret that was ever pushed needs rotating.
- **Dependency change** (WARN, "needs OK"): keep it only if the user agreed to it, and name it in the report. Otherwise take it out and recommend it, marked "needs OK". The script reads `package.json`, `composer.json`, `pyproject.toml`, `Pipfile`, `requirements*.txt`, `Cargo.toml`, `go.mod` and `Gemfile`. Check any other manifest yourself in step 4.

What it doesn't check: lockfiles, minified files, vendored folders and files marked generated (`linguist-generated` in `.gitattributes`, or an `@generated` or `DO NOT EDIT` header) skip every line check except secrets, conflict markers and deny patterns. In a script (a shebang, or a file under `scripts/` or `bin/`), prints count as real output and the usage comment at the top isn't a long comment block.

## 4. Judgment pass

Read the whole diff once against the project's own rules (its instructions, style guide or `CONTRIBUTING.md`). The script can't judge these:

- **One concern.** Hunks the task didn't need go, including drive-by cleanup in files you only read.
- **Reuse.** If you wrote something the codebase already has (a helper, a registry, a constant list), `git grep` for it and use the existing one.
- **Names before comments.** If logic needs explaining, a better name or structure comes first. Keep a comment only for a constraint the code can't show. Delete any comment your change made false.
- **No speculative handling.** No guards or fallbacks for cases that can't happen. Real failures skip, drop or throw, plainly.
- **Tests.** Only for logic a later change could quietly break, and none that mocks the function under test and asserts on the mock.
- **Removals.** Before deleting code that looked unused, search for callers, dynamic uses (string keys, reflection, config) and docs that name it.
- **Output.** If users will see a change, look at it running. If a refactor should change nothing, prove it: the `diff-proof` skill if it's installed, otherwise the same inputs through the base and the branch.
- **Commits.** Messages follow the project's convention, or Conventional Commits when it has none.

## 5. Loop, then report

Fix, commit, and rerun steps 2 and 3 until three things hold: verify passes, check-diff shows 0 errors, and every WARN is fixed or has a reason. If the same failure survives three attempts, stop and report it as blocked instead of looping.

Then report. Keep it short, and name every kept WARN with its reason. When a lead launched you, this report is your final message:

```
Self-review: ready after 2 passes.
Base: origin/main (feat/user-search was created from it)
Verify: `npm run lint && npm test` passed
check-diff: 0 errors, 1 kept warning
- WARN package.json: dependencies zod (none) -> ^3.23.8. Needs OK: you asked for request validation, and nothing in the repo does it yet.
Judgment: cut two narrating comments in src/search.ts, reverted a reformatted import block in src/index.ts.
```
