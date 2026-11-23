# Example `.agents/design-hillclimb.md`

Put this in the project for what its design policy and `AGENTS.md` or `CLAUDE.md` don't already say. Everything is optional; the skill works from the defaults in the rubric without it.

```markdown
# design-hillclimb settings for acme/web

- Design policy: `docs/design.md` (fonts, color roles, spacing tokens, minimum sizes, banned list).
- Pages: `node scripts/screens.mjs --routes <file> --widths 375,1440 --out <dir>`. Fonts are bundled,
  animations off, and `--now <ms>` freezes the clock.
- Images: `pnpm render-card <name> --fixture <file> --out <dir>`. People see them about 400 px wide.
- Fixtures: `test/fixtures/accounts/*.json`. Stress cases are made per run, in the run folder.
- Controls: the dashboard and the account page.
- Maximum height for images: 2,000 px.
- Layout metrics: `node scripts/layout-metrics.mjs <url>` (element bounds as JSON); the gridlines skill for edges.

## Owner calls
- 2026-03-02: The pricing table keeps scrolling sideways on phones (T2 declined).
- 2026-03-02: The empty state keeps its illustration.
- 2026-03-09: Totals stay right-aligned on every card, even in single-column layouts.
```
