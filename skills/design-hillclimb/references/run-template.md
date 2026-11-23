# Run template

A fill-in prompt for one long or unattended hillclimb run. Copy everything below the line into `.agents/design-hillclimb/<date>-<family>/prompt.md` (or wherever the run starts from), fill each `<…>`, and delete what doesn't apply (images or pages, attended or unattended). The skill holds the method, the judge, the budget and the cleanup, so the prompt only says what's specific to this run.

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
- **Cases:** <every saved fixture, plus display-only long-name and all-zero stress cases (`sNN`) with their provenance written down | the seeded routes and stress routes>, and the fewest-items state of every count-driven layout.
- **Controls:** <two well-known screens that share the components this run may touch>.
- **More:** <attended: at the start, ask whether to add <related screens>, recommending the ones above first | "none">.

## Owner's calls for this run

- **Targets:** <the open targets for this family | "the baseline's worst 6 to 10, as a shortlist for the owner">.
- **Budget:** about <N> candidates or <hours>. Stop new work before the host's usage limit if it shows one.
- **Changes:** one scoped commit per clear win on `<branch>`, and taste calls as A/B options (<asked in batches of up to four | in the morning sheet>).
- **Shared code:** <this run may edit shared components | changes stay inside the family's own files; anything shared becomes an option>.
- **Hand back:** keep the before and after images for the PR in the run folder. <Attended: ask whether to push `<branch>` and open a draft PR. | Unattended: write the morning sheet and push nothing.> Nothing is pushed until the owner says so.

## Conflicts to keep in mind

- **Open PRs** that edit these files: <from `gh pr list --state open --json number,title,files` at the start>. Prefer edits that don't overlap their hunks. Where one has to, name the PR in the ledger row and the PR description.
- **Other threads** editing shared components at the same time: <who, or "none">.

## Rules

- The project's instructions apply. Beyond them:
  - no network calls to production or third-party services;
  - no personal names or ids in code, tests, commits or captions;
  - user-facing text goes through the project's translation files, if it has them.
- End with the skill's report, including the judge calls by judge.
