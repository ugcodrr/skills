---
name: diff-proof
description: Prove what a branch changes in a program's output. Builds base and head in separate worktrees, runs the same probe commands on both with a frozen clock, seed and inputs, and reports what's identical, what differs and by how much (text diffs, JSON paths, files, pixel counts), plus before/after timings a PR can quote. Use it for refactors, cleanups and dependency bumps that should change nothing, for perf changes, before writing a perf number into a PR, and when asked to "prove it's identical", "did this change the output", "show before/after", "byte-identical", "pixel diff", "measure this PR" or "is it faster". Not for screenshots of a UI change (use pr-visuals) or for finding slow code by reading it (use perf-review).
---

# Diff proof

Answer one question with evidence: what does this branch change in what the program produces? One script builds both sides, runs the same probes through each, and writes a report you can quote. Use it instead of a one-off compare script, and instead of switching branches in the user's checkout.

Run it on every refactor, cleanup or perf change, and before any perf number goes into a PR. It's a report, not a gate: an intended difference is fine when the PR means it and says so. It's there to catch the differences nobody meant.

## 1. Set up the probes, once per project

The probes live in `.agents/diff-proof.json` at the repo root. Copy `references/diff-proof.json` and fill it in. Without the file the script stops with exit 2.

| Field | What it does |
|---|---|
| `setup` | Runs in a worktree the script creates, and again whenever that worktree moves to another commit (`npm ci`, `uv sync`, `go mod download`) |
| `build` | Runs on both sides before the probes, unless `--no-build` |
| `inputs` | A folder both sides read, taken from the head (or an absolute path), so a branch that edits fixtures doesn't compare different inputs |
| `env` | Extra environment for setup, build and probes. It can override the defaults below |
| `probes` | Each has a `name`, a `run` command (run by the shell from the checkout root) and a `kind` |

Probe kinds:

- `text` (default): stdout, compared as a unified diff capped at 60 lines.
- `json`: stdout parsed as JSON, compared path by path, ignoring key order. Each top-level key or array item counts as one item, with up to 5 changed paths each, as `base → head`.
- `files`: whatever the probe writes to `$DIFF_PROOF_OUT`, listed as added, removed and changed by a byte compare. A changed PNG gets a pixel diff (count, largest channel delta, how many differ by more than 16, and where). A changed JSON file gets path diffs, a text file line counts.
- `timing`: runs the command `runs` times (default 10) after a warmup, in rounds base, head, base, head, and keeps each side's lower p50, since other load on the machine only adds time. It times the whole command, unless its last stdout line is a JSON object of numbers (`{"parse ms": 12.1}`), which it uses instead.

Write probes that hold up:

- Cover what someone depends on: CLI output, API response bodies, generated files, rendered images, the shape of stored data (a schema or migration dump).
- Print keyed objects, not arrays, when items can be added (`{"alice": {...}}` rather than `[{...}]`), so one insert doesn't shift every later index.
- Keep probes offline. A probe that calls a live service compares the service, not the branch. Stub it or replay a recording.
- Sample a big corpus (every 20th item). A full corpus runs twice and holds both sides' output.
- Make `build` start clean (`rm -rf dist && ...`). A reused worktree keeps the last commit's output, and many compilers never delete output whose source is gone.
- The exit code counts as output. A probe that exits nonzero on both sides is still compared, with a note.

## 2. Freeze what you can

Both sides get the same values, so a difference comes from the code:

| Variable | Value |
|---|---|
| `DIFF_PROOF_NOW` | The run's start, in ms since the epoch. `SOURCE_DATE_EPOCH` gets the same instant in seconds, for build tools that stamp output |
| `DIFF_PROOF_SEED` | `1`, for any random generator the probe seeds |
| `TZ` | `UTC` |
| `DIFF_PROOF_INPUTS` | The absolute path of `inputs`, when set |
| `DIFF_PROOF_SIDE` | `base` or `head`, for logs only. A probe that branches on it isn't comparing the code |
| `DIFF_PROOF_OUT` | An empty folder for this probe and side |

Reading them:

- Node: `node --import "$DIFF_PROOF_FREEZE" <entry>` preloads `scripts/freeze.mjs`, which freezes `Date`, seeds `Math.random` and makes `crypto.randomUUID` count up. In tests, `vi.setSystemTime` or `jest.useFakeTimers({ now })`.
- Python: `random.seed(int(os.environ["DIFF_PROOF_SEED"]))`, a clock library such as time-machine or freezegun for `DIFF_PROOF_NOW`, and `"PYTHONHASHSEED": "0"` in `env` so set order holds.
- Anything else: pass the values as flags or config the program already takes.

Say in the report what you couldn't freeze (thread scheduling, map iteration order, a live dependency), since it can show up as a difference.

## 3. Run it

From the branch's checkout:

```sh
node <this skill's folder>/scripts/diff-proof.mjs [--base <ref|dir>] [--head <ref|dir>] [--probes a,b] [--no-build] [--out <dir>]
```

- The head defaults to this checkout, uncommitted changes included (the report says so). The base defaults to its merge-base with the default branch (`origin/HEAD`, else `main` or `master`), after a quiet fetch.
- For a stacked branch, pass its parent: `--base origin/<parent branch>`. Otherwise the parent's changes count too.
- A ref gets a detached worktree under `~/.cache/diff-proof/<repo>-<id>/` (or `$XDG_CACHE_HOME`), reused across runs. The worktrees sit outside the repo so the project's test runner and module resolution never find them. The script refuses a worktree with local changes, and a lock stops two runs from sharing one.
- The first run creates the base worktree and runs `setup`, which takes as long as a fresh clone's install. Later runs only build.
- Outputs and `report.md` go to `<tmp>/diff-proof/<repo>/<head>-vs-<base>/`, one folder per probe with each side's stdout, stderr and files.
- Exit 0: every probe identical. 1: something differs. 2: it couldn't check (no config, a failed setup or build, a probe killed or printing bad JSON).

## 4. Read and report

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
- For each difference, say whether the PR means it. When it doesn't, the probe's folder shows where. Fix the code, rebuild only the head, and rerun with `--no-build`.
- Timing: quote only numbers from the report, and name the machine they ran on ("on a laptop, not production"). A change marked "within noise" isn't a win; rerun with more `runs` or leave it out.
- In the PR description, quote the summary lines, not the whole report.

## Rules

- Never switch branches or stash in the user's checkout. Refs get worktrees.
- The script only builds and runs probes. It never pushes, posts or edits a PR. Anything public stays with the user.
- When the user is done with the project, `git worktree remove` the two worktrees under `~/.cache/diff-proof/`.
