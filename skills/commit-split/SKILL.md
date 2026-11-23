---
name: commit-split
description: Split a messy working tree into separate commits, one per unrelated change, in the project's commit style. It proposes the commits and their messages, then commits after the user's OK. Use it for "split this into commits", "commit these separately", "untangle my changes", "this diff mixes two things", "make clean commits", or before opening a PR from a tree with several changes in it. Not for rewriting commits already made (an interactive rebase) or writing the PR description (pr-describe).
---

# Commit split

Turn the working tree's changes into a series of commits, each holding one change, with a message in the project's style. Only the index and the commits change. The files on disk stay as they are the whole time.

## Rules

- Commit only after the user's OK on the plan, or right away if they asked you to commit. In an unattended run without that, stop at the plan.
- Don't push unless the user asked.
- Let commit hooks run. Don't pass `--no-verify` unless the user says so.
- Don't run `git stash`, `git checkout -- <file>`, `git restore` without `--staged`, or `git reset --hard` during a split. They rewrite the files, and the files hold every change not yet committed.

## 1. Read the rules

- **Commit style:** the project's AGENTS.md, CLAUDE.md or CONTRIBUTING.md, a commitlint config, else `git log --oneline -20`. With none of those, use Conventional Commits: `type(scope): summary`, imperative and lowercase, no period, about 72 characters at most, saying what changed. Add a body only for a reason the summary can't carry. A breaking change gets `!` before the `:` and a `BREAKING CHANGE:` footer.
- **Branch:** if you're on the default branch and the project branches before committing (a public repo usually does; `gh repo view --json visibility` tells you), make a short `feat/`, `fix/` or `chore/` branch part of the plan.

## 2. List the hunks

From the repo root:

```sh
node <this skill's folder>/scripts/hunks.mjs [-- <path>...]
```

- Text hunks carry no context, so each run of changed lines is its own hunk. Read `git diff -- <file>` when you need the code around one.
- New, deleted, binary, submodule and mode-only changes are one whole-file item each. A renamed file lists as a deleted item and a new file. A mode change on a text file goes in with that file's first staged hunk.
- An id hashes the file and the changed lines, so it stays the same while other hunks get committed. Run the list again whenever the files change.
- If it notes that something is already staged, ask whether that's meant to be the first commit. If not, `git reset -q` unstages it and leaves the files alone.
- Exit 1 means there are changes to split, 0 means the tree is clean, 2 means git failed or a merge is in progress.

## 3. Plan

Group the items into commits:

- One commit per change someone would review or revert on its own: a bug fix, a feature, a refactor, a formatting pass, a dependency bump, a docs edit.
- Keep together what has to land together: a function and its callers, code and its test, a schema and its migration, both halves of a rename, a lockfile and the manifest change behind it.
- Order the commits so each one builds where that's practical: a refactor before the feature that uses it.
- Formatting-only hunks inside a file with real changes get their own commit, unless the project says otherwise.
- Leave out anything that looks accidental (a debug print, a stray file, a large binary) and anything that looks like a secret (`.env`, credentials, tokens). List it under "Left out" and say why.
- When a hunk could go either way, pick the likelier commit and say so in the plan.

Show the plan, then stop:

```
Plan: 3 commits on a new branch fix/retry-cancel (from main)

1. fix(api): stop retrying after the request is canceled
   4610617 5af1865  src/retry.ts
   e4f5a6b          test/retry.test.ts
2. refactor(api): read retry delays from config
   db704a0          src/retry.ts
   config/retry.json (new file)
3. docs: describe the retry settings
   0c1d2e3          README.md

Left out: 9a91ca0 src/retry.ts:31, a console.log that looks like debugging.

Say go to commit, or change the grouping.
```

If the plan holds a decision (a "Left out" item, a hunk that could go either way) and the user is around, ask once, with all of them in one batch and your recommendation first (AskUserQuestion in Claude Code, otherwise one message with numbered options).

## 4. Commit

After the OK, for each planned commit, in order:

1. `node <this skill's folder>/scripts/hunks.mjs stage <id|path>...`. Check that the staged summary it prints matches the plan. Exit 2 means an id or path matched nothing, or git refused the patch: run the list again for current ids, and check `git diff --cached --stat` before you retry.
2. `git commit -m "<summary>"`, with a second `-m` for a body. If a hook fails or changes files, stop and report.
3. Run `hunks.mjs` again. The ids you just committed are gone, and every other id is still there, unchanged. The one allowed exception: a hunk identical to one you just committed in the same file can get a new id. Anything else (a missing id, a new one, a hook that ran `git add` and swept in other changes) means stop and report before the next commit.

## 5. Report

The commits made (hash and summary) and the branch they're on, then whatever is still in the tree and why:

```
3 commits on fix/retry-cancel:
- 7c41e2a fix(api): stop retrying after the request is canceled
- 0b9d3f8 refactor(api): read retry delays from config
- e52a1c4 docs: describe the retry settings

Still in the tree: 9a91ca0 src/retry.ts:31 (the console.log, left out on purpose).
```
