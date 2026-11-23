# Writing probes

Read this when `.agents/diff-proof.json` doesn't exist, or when a probe needs adding or changing. Start from `diff-proof.json` in this folder.

## The config

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

## Probes that hold up

- Cover what someone depends on: CLI output, API response bodies, generated files, rendered images, the shape of stored data (a schema or migration dump).
- Print keyed objects, not arrays, when items can be added (`{"alice": {...}}` rather than `[{...}]`), so one insert doesn't shift every later index.
- Keep probes offline. A probe that calls a live service compares the service, not the branch. Stub it or replay a recording.
- Sample a big corpus (every 20th item). A full corpus runs twice and holds both sides' output.
- Make `build` start clean (`rm -rf dist && ...`). A reused worktree keeps the last commit's output, and many compilers never delete output whose source is gone.
- The exit code counts as output. A probe that exits nonzero on both sides is still compared, with a note. A `timing` probe that exits nonzero fails the run.

## Freeze what you can

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

Note what you couldn't freeze (thread scheduling, map iteration order, a live dependency). It goes in the report, since it can show up as a difference.
