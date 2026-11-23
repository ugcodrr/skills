# Example `.agents/split-threads.md`

Put this file in the project (or `~/.agents/split-threads.md` for every project) only for what its `AGENTS.md`, `CLAUDE.md` or `CONTRIBUTING.md` doesn't already say. Everything here is optional.

```markdown
# split-threads settings for acme/shop

- Verify: `pnpm verify` (lint, typecheck, unit tests). Run it on the integration branch after the last merge.
- New worktrees: `pnpm install --frozen-lockfile && pnpm build --filter "./packages/*"` before anything else.
- One thread at a time: `packages/db/migrations/**`, `apps/api/src/auth/**`.
- Merge order: `packages/*`, then `apps/api`, then `apps/web`.
- Translation files: `locales/<lang>/app.json`; the base locale is `locales/en`.
- Threads can't: run the e2e suite (it needs staging credentials).
```
