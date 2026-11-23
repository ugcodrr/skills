# Run template

A fill-in prompt for one hillclimb run. Copy everything below the line into `.agents/design-hillclimb/<date>-<family>/prompt.md` (or wherever the run starts from), fill each `<…>`, and delete what doesn't apply (images or pages, attended or unattended). The skill holds the method, the judge, the budget and the cleanup, so the prompt only says what's specific to this run.

---

Design hillclimb on <the family: e.g. the profile cards | the settings pages>, for <a draft PR | local branches the owner reviews in the morning>. <Attended: decisions go to the owner, recommendation first. | Unattended: ask nothing; end with "Decided for you" and "Needs you".>

Work in <a new worktree from `origin/<default branch>` on the local branch `<type>/<name>` | `<worktree path>` on `<branch>` at `<full base SHA>`>. Run folder: `.agents/design-hillclimb/<date>-<family>/` in the main checkout. If its `progress.md` records a step, pick up from its next action.

Method, judge, budget and cleanup: the design-hillclimb skill and its rubric (`references/rubric.md`).

## Read first

- The skill and the rubric. Earlier ledgers on this family: <paths, or "none">.
- The owner's design rules: <the project's design policy, e.g. `docs/design.md`>, and `.agents/design-hillclimb.md` if it exists.
- <Anything specific: an ADR, a PR's description, an issue>.
- **Precedence:** this prompt's owner calls beat older documents. Keep their design decisions and safety rules, but don't run their integration, release or push steps.

## Family

- **Surface:** <images | pages at <phone> and <desktop>>.
- **What's in it:** <the render command and its variants | the routes>.
- **Cases:**
  - <every saved fixture, plus display-only long-name and all-zero stress cases with their provenance written down | the seeded routes and stress routes>;
  - the fewest-items state of every count-driven layout;
  - frozen in a case manifest with neutral ids (`<variant>.pNN`, `sNN` for stress cases) before any edit. The id to fixture mapping goes in its own file, never in captions.
- **Controls:** <two well-known screens that share the components this run may touch>.
- **More:** <attended: at the start, ask whether to add <related screens>, recommending the ones above first | "none">.

## Owner's calls for this run

- **Targets:** <the open targets for this family | "the baseline's worst 6 to 10, as a shortlist for the owner">.
- **Budget:** about <N> candidates or <hours>. Stop new work before the host's usage limit if it shows one.
- **Changes:**
  - one scoped commit per clear win on `<branch>`;
  - taste calls as A/B options (<asked in batches of up to four | in the morning sheet>);
  - nothing pushed until the owner says so.
- **Shared code:** <this run may edit shared components | changes stay inside the family's own files; anything shared becomes an option>.

## Steps

1. **Baseline:** freeze, capture, measure and score the family against the rubric. Register the existing violations in `ledger.md`.
2. **Shortlist** (attended): the 6 to 10 worst defects on one HTML page with crops, each with the criterion it fails. Ask which to work on, multi-select, recommendation first. Shared fixes that help several screens go first.
3. **Hillclimb** the picked defects with the skill's loop and judge.
4. **Self-review:** the project's verify, then before and after images for the PR (the `pr-visuals` skill if it's installed), kept in the run folder.
5. **Hand back** (attended): ask whether to push `<branch>` and open a draft PR. <Unattended: write the morning sheet, `index.html` in the run folder, as the rubric describes, and push nothing.>

## Conflicts to keep in mind

- **Open PRs** that edit these files: <from `gh pr list --state open --json number,title,files` at the start>. Prefer edits that don't overlap their hunks. Where one has to, name the PR in the ledger row and the PR description.
- **Other threads** editing shared components at the same time: <who, or "none">.

## Rules

- The project's instructions apply. Beyond them:
  - no network calls to production or third-party services;
  - no personal names or ids in code, tests, commits or captions;
  - user-facing text goes through the project's translation files, if it has them.
- End with the skill's report, including the judge calls by judge.

## Judge brief (`judge/<batch>/BRIEF.md`)

Fill it per batch. Only the blind set goes in the judge's folder; the key stays outside.

```
# Blind design review, batch <n> (<surface>)

You are the independent reviewer for a design pass on <the family>. Score the evidence against the rubric. Read-only: change no file, run no server, make no network call. Look only inside <absolute path to judge/<batch>/> for evidence.

## Read
- The rubric: <absolute path to the skill's references/rubric.md>.
- The owner's rules: <the design policy>, and the owner calls in the rubric<, and .agents/design-hillclimb.md>.

## Evidence
<The groups and their case ids, plus what each stress case is.>
Each case has two captures, A and B, of the same frozen inputs. The order is shuffled per case.
- index.html: A beside B at display size. Click an image for full size.
- <case>-A.png, <case>-B.png: full size, for crops.
- <metrics.json, if the run has per-case measurements: width, height, smallest label and headline at display size. Thresholds: labels < 6 px warn, < 5 severe; headlines < 12 warn, < 10 severe. Locators are not evidence.>

Notes:
- <How many cases render identically on both sides, so there's nothing to check there.>
- <Layout facts the judge needs, e.g. "a row splits its width equally among its cells".>
- Frozen recognition tasks: <per group, at display size>.
- Role map: <headline vs label and detail; declared equal tracks>.

## What to do
For each group:
1. Look at A and B for at least <cases>, plus any whose sizes differ sharply. Use full-size crops where the display view isn't enough.
2. Score A and B on R1 to R8 (0, 1 or 2). Every 0 or 1 names a region and one concrete visible reason.
3. Say which side is better, or that it's a tie or a taste call, and cite the visible defect behind it, not a preference. Name any case where the better side is worse on some criterion, and any new clipping, overlap, misalignment, staggered icons or text starts, hole, extra height for no gain, or unreadable text.
4. Run the recognition tasks on both sides of <cases> and say where one side is slower or fails.

Reply with one section per group: the vectors, the verdict, and the region-by-region findings with case ids. Under 900 words. Don't guess what changed or why; judge what you see.
```
