---
name: split-threads
description: Split a feature into parallel agent threads, each on its own branch and worktree, then merge them back and verify the result. Use it for "split this up", "parallelize this", "fan this out", "farm it out to agents", "run these in parallel", "launch a thread for each part", or a big change across several packages or several similar pages, endpoints or modes, even if nobody says "threads". Not for one independent look at your work (use second-opinion) or clearing old worktrees (use worktree-sweep).
---

# Split threads

Split one feature into slices that parallel agents can build at the same time without touching each other's files, then land them as one integration branch that passes the project's full verify. You're the lead: you plan, commit the shared base, launch, merge and verify. Each thread builds one slice in its own worktree.

The project's rules come first: its `AGENTS.md`, `CLAUDE.md` or `CONTRIBUTING.md` for the verify command, branch and commit style, and paths only one agent may edit at a time. Then `.agents/split-threads.md` if it exists (`references/settings-example.md` shows what it can hold). Without either, take the verify command from the CI workflow or the package scripts.

## Rules

- Nothing leaves the machine unasked. Don't push the integration branch or open a PR without the user's OK.
- Threads don't merge, rebase or push. You merge, in order.
- One owner per file. Translation JSON and lockfiles are the only shared files.
- Clean up only the worktrees and branches this run created.

## 1. Find the seams

List the files the feature touches. A similar past feature is the best map: `git show --stat <commit>`.

- **Split by folder.** Each thread owns exact globs (`apps/web/src/billing/**`). Good seams: one thread per similar unit (page, endpoint, mode, integration), or backend and frontend once the contract between them is on the base.
- **Order before parallel.** If slice B needs something slice A creates (a type, a schema field, a route, a built package), A's part goes on the base first, or A and B are one thread.
- **Two slices that edit the same file aren't parallel.** Make them one thread, or make that edit on the base yourself. Translation JSON and lockfiles are the exception, and you handle them at merge time.
- **A slice of one or two files isn't worth a thread.** Do it on the base.
- **Paths only one agent may edit at a time** go to exactly one thread, or to the base.
- **Work a thread can't do** (it needs credentials, a private submodule, a device or a live service): do it yourself, or tell the user now.

Show the split as a short table (slice, owned paths, depends on), then go on. Ask the user only about a decision that's theirs, like changing a shared contract, not to approve the plan.

## 2. Commit the shared base

```sh
git switch -c <type>/<feature>      # the integration branch
# shared edits: types and fields several slices read, translation keys several slices use,
# shared constants, dependencies you know a slice needs, the one-agent-at-a-time paths
<the project's build and typecheck, or its verify>
git add <paths> && git commit -m "<type>(<scope>): <the shared part>"
git rev-parse --short HEAD          # quote this in every prompt
```

Threads only see committed work. Uncommitted edits never reach a thread, and neither do commits you make after launch. If a thread needs a shared change mid-flight, commit it on the integration branch and tell that thread to run `git merge <type>/<feature>`.

## 3. Name the branches

`<type>/<feature>-<slice>`, with the integration branch's type: `feat/billing-invoices`, `feat/billing-webhooks`. One new branch per thread. Check that none exist yet: `git branch --list '<type>/<feature>-*'` prints nothing.

## 4. Write the prompts

Fill `references/thread-prompt.md` once per slice. Owned and forbidden paths are exact globs. "Already on the base" names real types, fields and keys, with the commit hash. Threads read the project's instructions on their own, so don't paste those in.

## 5. Launch

Launch every thread in the same turn.

- **T3 Code:** one `t3_thread_launch` per slice, with `workspaceStrategy: { type: "worktree", baseRef: "<type>/<feature>", branch: "<type>/<feature>-<slice>", startFromOrigin: false }`. Keep `startFromOrigin: false`. With `true`, T3 uses `origin/<baseRef>` when it exists, which silently drops unpushed base commits.
- **Claude Code:** one Agent call per slice with `isolation: "worktree"`, made while the integration branch is checked out and committed. The worktree starts from your current commit, so the prompt's first step creates the thread's branch.
- **Otherwise:** create each worktree yourself (`git worktree add -b <branch> ../<repo>-<slice> <type>/<feature>`) and give the user one prompt per worktree to start an agent session there.

New worktrees have no installed dependencies or build output. If the host runs a setup script for new worktrees, rely on it. Otherwise the prompt's first step runs the project's install.

## 6. Merge back

Wait for every thread's report. For each branch, check it committed everything and stayed in its lane:

```sh
git log --oneline <type>/<feature>..<branch>
git diff --stat <type>/<feature>...<branch>   # only its owned paths, plus merge-friendly files
git -C <worktree> status --short             # must be empty: uncommitted work doesn't merge
```

If a branch fails a check, send it back to its thread with the output. If the thread can't fix it, leave the branch out and say so in the report.

Merge in dependency order (shared packages, then services, then UI, unless the project says otherwise), biggest branch first within a layer. `git merge-tree --write-tree --name-only <type>/<feature> <branch>` previews which files will conflict without touching the tree.

```sh
git merge --no-ff <branch>
```

- **Translation or key JSON:** run `node <this skill's folder>/scripts/check-json-keys.mjs --resolve --base <base locale file or folder> <files or folders>`. It keeps both sides of each conflict and fixes the commas. Then it exits 1 on invalid JSON, on a key set twice (two threads set the same key), on a key another locale has that the base lacks, and on a conflict it couldn't resolve, which it leaves with its markers. Fix those by hand and rerun it until it exits 0.
- **Lockfiles:** never hand-merge one. Take the integration branch's side (`git checkout --ours -- <lockfile>`), rerun the package manager's install so it resolves the merged manifests, and confirm with its locked mode (`npm ci`, `pnpm install --frozen-lockfile`, `cargo build --locked`). If the diff bumps packages no manifest change asked for, say so in the report.
- **Any other file:** the split overlapped. Resolve it by hand from both threads' reports, and say so in the report.

Once every conflicted file is resolved, read `git diff`, then `git add <files> && git commit --no-edit --cleanup=strip`. Plain `--no-edit` keeps git's `# Conflicts:` lines in the message.

## 7. Verify

Run the project's full verify on the integration branch, after a fresh install if a lockfile changed. For UI work, look at every screen a thread changed (the `pr-visuals` skill if it's installed, otherwise screenshots). Fix a small failure on the integration branch yourself. Send a large one back to the thread that owns it, then merge again. If the same failure survives two rounds, stop and report it.

## 8. Clean up and report

Close each thread through the host (in T3, settling a thread removes its worktree). Otherwise, from the integration branch, for the worktrees and branches this run created:

```sh
git worktree remove <worktree>   # refuses on modified or untracked files: look before adding --force
git branch -d <branch>           # refuses an unmerged branch, which is the point
```

Then report. Keep each thread branch and hash in the record. Mention a conflict only when it changed the result. Carry forward every check a thread couldn't run.

```
feat/billing at 4f2c9e1: invoices, webhooks and settings merged; verify passes. Not pushed.

Merged: feat/billing-invoices a1b2c3d, feat/billing-webhooks e4f5a6b, feat/billing-settings c7d8e9f
Conflicts: locales/en/app.json, both added billing keys; kept both
Not checked: webhook retries (needs the payment provider's sandbox)
Needs you: OK to push feat/billing and open a PR
Cleanup: 3 worktrees removed, 3 thread branches deleted
```
