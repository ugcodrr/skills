# Unattended runs in acme/api

Copy to `.agents/unattended.md` in the project (or `~/.agents/unattended.md` for every project) and fill in your own values. A run's brief overrides anything here.

## Budget
- Measure: items finished and build attempts, both counted in the log. If the log can't be read, treat the run as over the hard limit.
- Soft limit: 4 items (start no new item after the fourth).
- Hard limit: 20 build attempts (stop building at 20).
- Wall clock: stop by 07:00 local time, whatever the budget says.

## Verify
- Fast: `npm run typecheck && npx vitest run <changed folder>`, which must exit 0 and print a nonzero test count.
- Full: `npm run verify`, which must exit 0. Run one at a time; it uses every core.

## Off limits
- `migrations/` and `infra/`: a human reviews every change there.
- Any branch named `release/*`.
- Worktrees under `~/src/acme-api/.worktrees/` that another thread has checked out.

## Outward actions
- Default: none. Commit to local branches only.
- A brief may allow `git push -u origin <branch>` for a new branch and `gh pr create --draft`. Never mark a PR ready, merge, comment or add reviewers.
