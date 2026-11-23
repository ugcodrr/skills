---
name: diff-proof
description: Prove what a branch changes in a program's output. It runs the same commands on base and head and reports what's identical, what differs and by how much, plus timings a PR can quote. Use it for refactors and dependency bumps that should change nothing, before a perf number goes in a PR, and for "prove it's identical", "did this change the output", "show before/after", "pixel diff", "measure this PR" or "is it faster". Not for UI screenshots (pr-visuals) or finding slow code (perf-review).
---

# Diff proof

Answer one question with evidence: what does this branch change in what the program produces? One script builds both sides, runs the same probes through each, and writes a report you can quote. Use it instead of a one-off compare script, and instead of switching branches in the user's checkout.

It's a report, not a gate. An intended difference is fine when the PR means it and says so. The run is there to catch the differences nobody meant.

## Rules

- Never switch branches or stash in the user's checkout. Refs get worktrees.
- The script only builds and runs probes. Don't push, post or edit a PR from here. Anything public stays with the user.
- Remove the worktrees under `~/.cache/diff-proof/` (`git worktree remove`) only when the user says they're done with the project.

## 1. Check the probes

Probes are the commands both sides run, with a `kind` of `text`, `json`, `files` or `timing`. They live in `.agents/diff-proof.json` at the repo root, shaped like `references/diff-proof.json`. Read `references/probes.md` before you write or change one.

1. No file: write it. The script exits 2 without one.
2. List what the branch touches (`git diff --stat <base>`) and check that at least one probe runs that code. If none does, "identical" proves nothing, so add a probe first.
3. A perf claim needs a `timing` probe. Add one if there's none.

## 2. Run it

From the branch's checkout:

```sh
node <this skill's folder>/scripts/diff-proof.mjs [--base <ref|dir>] [--head <ref|dir>] [--probes a,b] [--no-build] [--out <dir>]
```

- The head defaults to this checkout, uncommitted and untracked changes included (the report says so). Don't stage, commit or stash anything in it.
- The base defaults to the head's merge-base with the default branch (`origin/HEAD`, else `main` or `master`), after a quiet fetch. For a stacked branch, pass its parent as `--base origin/<parent branch>`, or the parent's changes count too.
- A ref gets a detached worktree under `~/.cache/diff-proof/<repo>-<id>/` (or `$XDG_CACHE_HOME`), reused across runs. The first run creates it and runs `setup`, which takes as long as a fresh clone's install, so run it in the background. Later runs only build.
- Outputs and `report.md` go to `<tmp>/diff-proof/<repo>/<head>-vs-<base>/`, one folder per probe with each side's stdout, stderr and files.
- Exit 0: every compared probe is identical. 1: something differs. 2: it couldn't check (no config, a failed setup or build, a probe killed or printing bad JSON). A `timing` probe never changes the exit code.
- It stops (exit 2) when a cached worktree has local changes, or when another run holds the lock. Clean the worktree, or wait for the other run.

## 3. Read and report

```
# diff-proof: head 9b9b73526 vs base f61cf3e19

- base: f61cf3e19 (merge-base with origin/main), ~/.cache/diff-proof/api-a5949914/base
- head: 9b9b73526 plus uncommitted changes, ~/src/api
- frozen: DIFF_PROOF_NOW 2026-01-15T09:30:00.000Z, DIFF_PROOF_SEED 1, TZ UTC, inputs ~/src/api/fixtures

## help: identical
## report: differs
1 of 3 items differ (3 paths).
- `users`: `alice.average` (none) → 8.5; `bob.average` (none) → 5; `carol.average` (none) → 12
## charts: differs
- changed `blue.png`: 585 of 2048 pixels differ (28.56%), max delta 4/255, 0 visible (delta > 16), within x 11-49, y 9-23
## bench: timed
| wall ms | 67.1 | 46.8 | -30.2% | 67.1, 68.8 / 47.1, 46.8 |
```

- Say "identical" only when the probe says so. "585 pixels off by at most 4/255" is a difference: report it as one and let the user decide whether it matters.
- For each difference, say whether the PR or the user says it's meant. If nothing says, mark it unknown and ask: don't guess. The probe's folder shows where it differs. Change the code only when the user asks, then rebuild only the head and rerun with `--no-build`.
- Timing: quote only numbers from the report, and name the machine they ran on ("on a laptop, not production"). A change marked "within noise" isn't a win. Rerun with more `runs` or leave it out.

Report to the user in this order, and keep it short: one line per probe with its result, which probe covers the change, each difference marked intended, unintended or unknown, then what you couldn't freeze or cover (thread scheduling, map iteration order, a live dependency). In a PR description, quote the summary lines, not the whole report.
