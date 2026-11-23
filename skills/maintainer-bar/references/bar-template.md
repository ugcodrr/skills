# Bar template

Copy the example below into `.agents/maintainer-bar.md` and replace it with what your maintainer actually does. Everything in it is fictional: alice maintains `acme/api`. Keep the three sections, cite a PR for every point, and keep the whole file under about 50 lines so a reviewer reads all of it. "How to calibrate it" at the end says where the evidence comes from.

## Example

```markdown
# The bar: what alice looks for

alice (GitHub `alice`) maintains acme/api and reviews and merges most PRs. Calibrated 2026-03-02 on her inline comments and review bodies since 2025-12-01, the PRs she edited herself before merging (`maintainer-edits.mjs`), the PRs she closed without merging, and her own #402 and #431. Rechecked 2026-04-10: nothing new. PR numbers are the evidence; a request from another reviewer doesn't count as hers.

CONTRIBUTING.md already covers formatting, tests and commit style. This file doesn't repeat it.

## Would she want it

These points decide what goes in the report. They never decide what a reviewer deletes.

- She takes outside contributions of any size when they link an issue (#318, #344). A PR's category alone is no reason to recommend dropping it.
- Read why she closed a PR before generalizing: #311 duplicated an open PR, #350 needed a design discussion first. Report a concrete mismatch; never infer a blanket ban.
- Breaking API changes go behind a deprecation: the old field stays for one minor release with a `Deprecation` header (#377).
- Risky behavior changes ship behind a feature flag that defaults to off (#329).

## How the code should look

- Migrations are reversible: every `up` has a `down`, and backfills run as a separate job, not inside the migration (#340, #366).
- Errors say what to do next: "token expired, call /auth/refresh" over "unauthorized" (#367).
- Logs are structured: fields, not string interpolation, and never a token or an email address (#371).
- Perf claims come with a benchmark run on the PR and before and after numbers in the description (#380).
- New config has a default and a line in `docs/config.md` (#388).

## The PR

- One concern per PR (#351, #359). She asks for unrelated cleanup to go in its own PR.
- A change to a response shape shows the before and after JSON in the description (#373).
- User-facing changes add a line to `CHANGELOG.md` under Unreleased (#345).
- Short descriptions. #390 is the model for a small fix: one sentence on what was wrong, one Testing line.
```

## How to calibrate it

1. Pick a window: the last 90 days, or since the maintainer's habits last changed. Write it into the header.
2. Start with what they changed themselves before merging, the strongest evidence there is:
   `node <this skill's folder>/scripts/maintainer-edits.mjs --maintainer <login> --since <date>`
3. Read their inline review comments:
   `gh api --paginate "repos/<owner>/<repo>/pulls/comments?since=<date>&per_page=100" --jq '.[] | select(.user.login == "<login>") | "\(.pull_request_url | split("/") | last) \(.path): \(.body)"'`
4. Read their review bodies and change requests: `gh pr list --state all --search "reviewed-by:<login> updated:>=<date>" --json number,title,reviews`.
5. Read why PRs closed without merging: `gh pr list --state closed --search "closed:>=<date> -is:merged" --json number,title`, then the closing comment on each.
6. Skim their own recent PRs as models of what they like: `gh pr list --author <login> --state merged --limit 20`.
7. Write each point as a rule followed by its evidence (`#n`, or a short quote). Attribute carefully: their request versus another reviewer's, a suggestion versus an accepted design, an old comment versus one that still stands.
8. Leave out anything the project's own rules files already say, and anything you saw only once that the maintainer didn't insist on.
9. Recalibrate when their reviews show something new, or every couple of months. Record the recheck in the header, even when nothing changed.

Show the user the draft before the first sweep. It's their read of the maintainer, and they'll know where it's wrong.
